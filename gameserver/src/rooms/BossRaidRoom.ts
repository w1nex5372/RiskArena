import "reflect-metadata";
import { Room, Client } from "colyseus";
import axios from "axios";
import { BossRaidState, RaidPlayer } from "../schemas/BossRaidState";
// Shared combat rules — single source of truth (also used by ArenaRoom)
import { classMaxHp, resolveDamage } from "../shared/combat";
// Shared class metadata (battle_classes.json) — per-class HP/greitis/žala/block
import { classGuard, classMoveSpeed, classBasicAttack } from "../shared/classes";
// Shared ability metadata helpers — single source of truth (also used by ArenaRoom)
import { abilityMeta, abilityNumber, abilityCooldownMs, abilityAllowedForClass } from "../shared/abilities";
// Shared boss metadata (boss_definitions.json) — BOSS REGISTRY: žala/dažnis/range/targets per boss
import { DEFAULT_BOSS_KIND, bossAttackDamage, bossAttackCadence, bossMaxTargets, bossHitX } from "../shared/bosses";

const FASTAPI_URL       = process.env.FASTAPI_URL       || "http://localhost:8001";
const SKIP_AUTH         = process.env.SKIP_AUTH         === "true";
const INTERNAL_SECRET   = process.env.INTERNAL_SECRET;

// ── Damage constants (mirrors boss_domain.py) ─────────────────────────────────
const BASE_DAMAGE      = 10;
const DAMAGE_VARIANCE  = 2;   // ±2
const ATTACK_COOLDOWN_MS = 1500; // minimum ms between attacks per player

// ── Action-state model (Phase 4) ──────────────────────────────────────────────
// Serveris yra vienintelis šaltinis žaidėjo veiksmo būsenai. Klientai tik renderina.
const STATE = {
  IDLE:      "idle",
  MOVING:    "moving",     // rezervuota Phase 5
  ATTACKING: "attacking",
  HIT:       "hit",
  DEAD:      "dead",
  DOWNED:    "downed",     // Group A: nokautuotas (hp<=0), atsigauna po REVIVE_MS
} as const;

// Group A: boso atakos žala pagal fazę gyvena boss_definitions.json (žr. ../shared/bosses).
const REVIVE_MS = 60000; // 1 min — kiek laiko nokautuotas žaidėjas atsigauna

// Nokautuotų žaidėjų revive laikas PAGAL userId — MODULE-level (gyvena per visus room'us
// šiame gameserver procese), kad išėjus/grįžus (net solo, kai room'as disposinasi)
// death timer'is nepasiresetintų (anti-exploit). { userId: reviveAt ms }
const DOWNED_UNTIL = new Map<string, number>();

const ATTACK_STATE_MS = 400; // kiek laiko žaidėjas lieka "attacking" po smūgio
const HIT_STATE_MS    = 500; // kiek laiko žaidėjas lieka "hit" kai bosas pataiko
const SIM_TICK_MS     = 100; // kas kiek tikriname ar transient būsenos pasibaigė

// Boso atakos dažnis [minMs, maxMs], max targets ir "hit" pozicija X gyvena
// boss_definitions.json (žr. ../shared/bosses). Žaidėjai juda iki MOVE_MAX_X (470);
// bosas dešinėj (~500). Melee (bash range 120, warrior basic 86) reikia prieiti arti;
// projectile (range 800) ir mage basic (150) pataiko iš toliau.

// ── Movement model (Phase 5) ──────────────────────────────────────────────────
// Pozicija yra grynai kosmetinė (neturi įtakos damage'ui), todėl ji client-authoritative:
// klientas siunčia savo x, serveris tik apkarpo į ribas ir saugo. Anti-cheat čia nereikia.
const MOVE_MIN_X = 30;
const MOVE_MAX_X = 470; // turi sutapti su BossRaidScene PLAYER_STOP_X (kitaip serveris apkarpytų poziciją)
const SPAWN_SLOTS_X = [90, 150, 220, 300, 360]; // pradinės pozicijos — kad žaidėjai nesistumtų į krūvą
const MOVE_MIN_INTERVAL_MS = 50; // server-side throttle "move" žinutėms (≤20/s/žaidėjui)

// ── Raid liveness (Phase 6) ───────────────────────────────────────────────────
// Kas tiek tikriname ar mūsų raid'as vis dar aktyvus FastAPI pusėje. Bosas gali
// "expire" pagal laiką (FastAPI spawner), o Colyseus room apie tai nežinotų.
const RAID_LIVENESS_POLL_MS = 15000;

// ── Phase thresholds (mirrors boss_domain.py compute_phase) ──────────────────
function computePhase(currentHp: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  const pct = currentHp / maxHp;
  if (pct <= 0.25) return 3;
  if (pct <= 0.60) return 2;
  return 1;
}

// ── Simple damage roll ────────────────────────────────────────────────────────
function rollDamage(attackBonus = 0, attackPct = 0, bossDamagePct = 0): number {
  const variance   = Math.floor(Math.random() * (DAMAGE_VARIANCE * 2 + 1)) - DAMAGE_VARIANCE;
  const base       = BASE_DAMAGE + variance + attackBonus;
  const multiplier = 1.0 + attackPct + bossDamagePct;
  return Math.max(1, Math.round(base * multiplier));
}

// ─────────────────────────────────────────────────────────────────────────────
export class BossRaidRoom extends Room<BossRaidState> {
  // Colyseus leidžia iki 100 klientų vienam room'ui — tinka boss raid'ui
  maxClients = 100;

  // Boso atakos ciklo timer'is (clock.setTimeout handle) — kad galėtume sustabdyti
  private bossAttackTimer: any = null;
  // Periodinis raid'o gyvybingumo tikrinimas (clock.setInterval handle)
  private resyncTimer: any = null;
  // Aktyvaus boso tipas — nustatomas iš FastAPI (d.kind), su atsarga į DEFAULT_BOSS_KIND.
  // Iš jo skaitomi boss combat parametrai per ../shared/bosses (BOSS REGISTRY).
  private bossKind: string = DEFAULT_BOSS_KIND;

  // ── Room kūrimas ────────────────────────────────────────────────────────────
  async onCreate(options: any) {
    this.setState(new BossRaidState());

    // Bandome užkrauti aktyvų raid'ą iš FastAPI
    await this.syncFromFastApi();

    // "attack" žinutė ateina kai žaidėjas paspaudžia attack mygtuką
    this.onMessage("attack", (client) => this.handleAttack(client));

    // "ability" — žaidėjas panaudoja klasės/item ability prieš bosą (Group A item 1)
    this.onMessage("ability", (client, msg) => this.handleAbility(client, msg));

    // "move" — klientas praneša savo poziciją (Phase 5). Serveris apkarpo ir saugo.
    this.onMessage("move", (client, msg) => this.handleMove(client, msg));

    // "block" — klientas laiko/atleidžia block mygtuką (Group A gynyba)
    this.onMessage("block", (client, msg) => this.handleBlock(client, msg));

    // Simulation tick — grąžina pasibaigusias transient būsenas (attacking/hit) į idle.
    // Viena vieta valdo visų žaidėjų būsenų gyvavimo laiką (vietoj N atskirų setTimeout'ų).
    this.setSimulationInterval(() => this.tick(), SIM_TICK_MS);

    // Boso atakos ciklas — serveris pats sprendžia kada ir ką bosas pataiko
    this.scheduleBossAttack();

    // Periodiškai tikriname ar raid'as vis dar aktyvus (kad pagautume "expired" atvejį)
    this.resyncTimer = this.clock.setInterval(() => this.checkRaidLiveness(), RAID_LIVENESS_POLL_MS);

    console.log(`[BossRaidRoom] Room created, raidId=${this.state.raidId || "none"}`);
  }

  // Iškviečiama kai room'as uždaromas — sustabdome visus timer'ius
  onDispose() {
    if (this.bossAttackTimer) { this.bossAttackTimer.clear?.(); this.bossAttackTimer = null; }
    if (this.resyncTimer)     { this.resyncTimer.clear?.();     this.resyncTimer = null; }
  }

  // ── Auth: ta pati logika kaip ArenaRoom ─────────────────────────────────────
  async onAuth(_client: Client, options: { sessionToken?: string; devUsername?: string }) {
    if (SKIP_AUTH) {
      if (options.sessionToken) {
        try {
          const res = await axios.get(`${FASTAPI_URL}/api/me`, {
            headers: { Authorization: `Bearer ${options.sessionToken}` },
            timeout: 3000,
          });
          return res.data;
        } catch {}
      }
      return {
        id:         `dev-${Math.random().toString(36).slice(2, 7)}`,
        first_name: options.devUsername || "Raider",
        class_name: "warrior",
        character_spritesheet_path: "",
      };
    }

    const token = options?.sessionToken;
    if (!token) throw new Error("No session token");

    const res = await axios.get(`${FASTAPI_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    return res.data;
  }

  // ── Žaidėjas prisijungia ─────────────────────────────────────────────────────
  onJoin(client: Client, _options: any, auth: any) {
    const p = new RaidPlayer();
    p.sessionId      = client.sessionId;
    p.userId         = String(auth?.id ?? client.sessionId);
    p.username       = auth?.first_name || "Raider";
    p.characterClass = (auth?.class_name || "warrior").toLowerCase();
    p.spritesheetPath = String(
      auth?.battle_spritesheet_path || auth?.character_spritesheet_path || ""
    );
    // Išdėstome pradinę poziciją cikliškai — kad nauji žaidėjai nestovėtų vienas ant kito
    p.x = SPAWN_SLOTS_X[this.state.players.size % SPAWN_SLOTS_X.length];
    p.facingRight = true;
    // Group A: HP + greitis pagal klasę (iš battle_classes.json — vienas šaltinis su Arena)
    p.maxHp = classMaxHp(p.characterClass);
    p.hp    = p.maxHp;
    p.defendReduction = Number(auth?.defend_reduction ?? 0) || 0;
    // move_speed json'e yra units/tick (Arena 66ms tick); px/s = units * (1000/66)
    p.moveSpeed = Math.round(classMoveSpeed(p.characterClass) * (1000 / 66));

    // Anti-exploit: jei žaidėjas buvo nokautuotas ir išėjo — grįžęs lieka nokautuotas
    // su LIKUSIU laiku (negali apeiti death timer'io išėjęs/atėjęs).
    const reviveAt = DOWNED_UNTIL.get(p.userId);
    if (reviveAt && Date.now() < reviveAt) {
      p.hp            = 0;
      p.state         = STATE.DOWNED;
      p.stateUntil    = reviveAt;
      p.reviveSeconds = Math.ceil((reviveAt - Date.now()) / 1000);
    } else if (reviveAt) {
      DOWNED_UNTIL.delete(p.userId); // revive laikas praėjo — gyvas
    }

    this.state.players.set(client.sessionId, p);
    this.state.playerCount = this.state.players.size;

    console.log(`[BossRaidRoom] ${p.username} joined (${this.state.playerCount} online)`);
  }

  // ── Žaidėjas išeina ──────────────────────────────────────────────────────────
  onLeave(client: Client) {
    // Skaitome vardą PRIEŠ delete — kitaip get() grąžintų undefined
    const username = this.state.players.get(client.sessionId)?.username ?? client.sessionId;
    this.state.players.delete(client.sessionId);
    this.state.playerCount = this.state.players.size;

    console.log(`[BossRaidRoom] ${username} left (${this.state.playerCount} online)`);
  }

  // ── Attack handler ───────────────────────────────────────────────────────────
  private async handleAttack(client: Client) {
    // Raid turi būti aktyvus
    if (this.state.status !== "active" || this.state.currentHp <= 0) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    // Group A: negali atakuoti kai nokautuotas arba laikant block (trade-off kaip Arena)
    if (player.state === STATE.DOWNED || player.blocking) return;

    // Server-side cooldown — klientas negali apgauti siųsdamas žinutes greičiau
    const now = Date.now();
    if (now - player.lastAttackAt < ATTACK_COOLDOWN_MS) return;
    player.lastAttackAt = now;

    // Basic attack žala pagal klasę (iš battle_classes.json — warrior kerta stipriau)
    const ba = classBasicAttack(player.characterClass);
    // Range — melee klasės (warrior/rogue) turi prieiti prie boso; mage range didesnis
    if (!this.inBossRange(player, ba.range)) {
      // Whiff — mostas parodomas, bet bosui žalos nedaro (reikia prieiti arčiau)
      if (player.state !== STATE.HIT) { player.state = STATE.ATTACKING; player.stateUntil = now + ATTACK_STATE_MS; }
      return;
    }
    const damage = ba.damage_min + Math.floor(Math.random() * Math.max(1, ba.damage_max - ba.damage_min + 1));

    // Taikome HP
    const newHp    = Math.max(0, this.state.currentHp - damage);
    const newPhase = computePhase(newHp, this.state.maxHp);

    this.state.currentHp = newHp;
    this.state.phase     = newPhase;
    player.totalDamage  += damage;

    // Veiksmo būsena → attacking. tick() grąžins į idle kai stateUntil pasibaigs.
    // Neperrašome "hit" jei žaidėjas šiuo metu gauna smūgį — hit svarbiau vizualiai.
    if (player.state !== STATE.HIT) {
      player.state      = STATE.ATTACKING;
      player.stateUntil = now + ATTACK_STATE_MS;
    }

    // Persiunčiame damage skaičių atakavusiam žaidėjui
    // (kad galėtų parodyti skaičių virš boso)
    client.send("damage_dealt", { damage, hp: newHp, maxHp: this.state.maxHp });

    // Bosas nugalėtas — bendra logika (žr. maybeHandleBossDefeated, kad nebūtų dubliuota)
    this.maybeHandleBossDefeated(newHp);

    // DB'e išsaugome damage (per FastAPI) — async, neblokuoja room'o
    this.persistDamage(player.userId, damage).catch((err) =>
      console.warn("[BossRaidRoom] Failed to persist damage:", err?.message)
    );
  }

  // ── Ability handler (Group A item 1) ─────────────────────────────────────────
  // Žaidėjas panaudoja klasės default arba įsigytą item ability prieš bosą.
  // Žala ir cooldown imami iš bendro shared/battle_abilities.json (server-authoritative —
  // klientu nepasitikime nei žalai, nei cooldown'ui). Damage taikomas TIKSLIAI kaip
  // handleAttack (computePhase, attacking būsena, damage_dealt, defeat, persistDamage).
  private async handleAbility(client: Client, msg: any) {
    // Raid turi būti aktyvus
    if (this.state.status !== "active" || this.state.currentHp <= 0) return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    // Negali naudoti ability kai nokautuotas arba laikant block (kaip handleAttack)
    if (player.state === STATE.DOWNED || player.blocking) return;

    // Ability key — tuščias => klasės default. Validuojame priklausomybę klasei.
    let abilityKey = String(msg?.abilityKey || "");
    if (!abilityKey) abilityKey = `${player.characterClass}_default`;
    if (!abilityAllowedForClass(player.characterClass, abilityKey)) return;

    // Per-ability server-side cooldown PAGAL KEY — klasės ir item ability nepriklausomi
    // (anti-cheat; klientas negali spam'inti). Naudoja shared metadata cooldown_ms.
    // Cooldown nustatomas net jei ability nedaro žalos (blink) ar prašauna — buvo "panaudotas".
    const now = Date.now();
    if (now - (player.abilityCooldowns[abilityKey] || 0) < abilityCooldownMs(abilityKey, 6000)) return;
    player.abilityCooldowns[abilityKey] = now;

    // Žala TIK iš metadata — be fallback. Blink/mobility (type: "blink") neturi "damage"
    // lauko → 0 → jokios žalos bosui (teleportas vyksta client-side per move).
    const meta   = abilityMeta(abilityKey);
    const damage = abilityNumber(meta, "damage", 0);
    const range  = abilityNumber(meta, "range", 9999);

    // Ne-žalos ability (blink) ARBA per toli (melee bash reikia prieiti; projectile range 800)
    // → naudojimas užskaitytas (cooldown), bet bosui žalos nedaro.
    if (damage <= 0 || !this.inBossRange(player, range)) return;

    // Taikome HP — tiksliai kaip handleAttack
    const newHp    = Math.max(0, this.state.currentHp - damage);
    const newPhase = computePhase(newHp, this.state.maxHp);

    this.state.currentHp = newHp;
    this.state.phase     = newPhase;
    player.totalDamage  += damage;

    // Veiksmo būsena → attacking (kaip handleAttack). tick() grąžins į idle.
    if (player.state !== STATE.HIT) {
      player.state      = STATE.ATTACKING;
      player.stateUntil = now + ATTACK_STATE_MS;
    }

    client.send("damage_dealt", { damage, hp: newHp, maxHp: this.state.maxHp });

    this.maybeHandleBossDefeated(newHp);

    this.persistDamage(player.userId, damage).catch((err) =>
      console.warn("[BossRaidRoom] Failed to persist damage:", err?.message)
    );
  }

  // Ar žaidėjas pakankamai arti boso konkrečios atakos/ability range'ui
  private inBossRange(player: RaidPlayer, range: number): boolean {
    return Math.abs(bossHitX(this.bossKind) - player.x) <= range;
  }

  // ── Boso pralaimėjimo apdorojimas (bendras handleAttack + handleAbility) ──────
  // Iškviečiama po žalos taikymo. Jei bosas nukrito iki 0 (ir vis dar buvo aktyvus),
  // užbaigia raid'ą, sustabdo timer'ius, užrakina room'ą ir praneša FastAPI.
  private maybeHandleBossDefeated(newHp: number) {
    if (newHp <= 0 && this.state.status === "active") {
      this.state.status = "defeated";
      if (this.bossAttackTimer) { this.bossAttackTimer.clear?.(); this.bossAttackTimer = null; }
      if (this.resyncTimer)     { this.resyncTimer.clear?.();     this.resyncTimer = null; }
      // Užrakiname room'ą — nauji žaidėjai (joinOrCreate) nebepateks į pasibaigusį
      // raid'ą; jiems bus sukurtas naujas room'as, kuris pasiims naują bosą.
      this.lock();
      console.log(`[BossRaidRoom] Boss defeated! raidId=${this.state.raidId}`);

      // Pranešame FastAPI kad settler'intų rewards
      this.notifyFastApiDefeated().catch((err) =>
        console.warn("[BossRaidRoom] Failed to notify FastAPI of defeat:", err?.message)
      );
    }
  }

  // ── Movement (Phase 5) ───────────────────────────────────────────────────────
  // Klientas siunčia savo x ir kryptį; serveris apkarpo į ribas ir saugo state'e.
  // Pozicija kosmetinė, todėl pasitikime klientu (tik clamp prieš out-of-bounds).
  private handleMove(client: Client, msg: any) {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.state === STATE.DEAD) return;
    // Server-side throttle — apsauga nuo "move" spam'o (anti-cheat + perf at scale)
    const now = Date.now();
    if (now - p.lastMoveAt < MOVE_MIN_INTERVAL_MS) return;
    p.lastMoveAt = now;
    if (typeof msg?.x === "number" && Number.isFinite(msg.x)) {
      p.x = Math.max(MOVE_MIN_X, Math.min(MOVE_MAX_X, msg.x));
    }
    if (typeof msg?.facingRight === "boolean") {
      p.facingRight = msg.facingRight;
    }
  }

  // ── Block (Group A) ──────────────────────────────────────────────────────────
  // Kol laikomas, gina nuo boso atakos (žr. doBossAttack). Negali atakuoti laikant
  // block (handleAttack patikrina) — toks pat trade-off kaip Arenoje.
  private handleBlock(client: Client, msg: any) {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.state === STATE.DOWNED || p.state === STATE.DEAD) return;
    p.blocking = !!msg?.down;
  }

  // ── Simulation tick — transient būsenų gyvavimo laikas ───────────────────────
  // Kas SIM_TICK_MS tikriname kiekvieną žaidėją: jei jo attacking/hit būsena
  // pasibaigė (now >= stateUntil), grąžiname į idle. Vienintelė vieta kur
  // transient būsenos baigiasi — laikymas serveryje => visi klientai mato vienodai.
  private tick() {
    const now = Date.now();
    this.state.players.forEach((p) => {
      if (p.state === STATE.DEAD) return; // dead yra terminalinė
      if (p.stateUntil > 0 && now >= p.stateUntil && p.state !== STATE.IDLE) {
        if (p.state === STATE.DOWNED) {
          p.hp = p.maxHp;            // revive — atstatom HP
          p.reviveSeconds = 0;
          DOWNED_UNTIL.delete(p.userId);
        }
        p.state      = STATE.IDLE;
        p.stateUntil = 0;
      }
    });
  }

  // ── Boso atakos ciklas ───────────────────────────────────────────────────────
  // Suplanuoja kitą boso ataką pagal dabartinę fazę. Rekursyviai persiplanuoja.
  private scheduleBossAttack() {
    if (this.bossAttackTimer) { this.bossAttackTimer.clear?.(); this.bossAttackTimer = null; }
    if (this.state.status !== "active") return;
    const [minMs, maxMs] = bossAttackCadence(this.bossKind, this.state.phase);
    const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
    this.bossAttackTimer = this.clock.setTimeout(() => this.doBossAttack(), delay);
  }

  // Bosas atakuoja: pasirenka iki bossMaxTargets() atsitiktinių prisijungusių žaidėjų,
  // pažymi juos "hit" būsena (be HP — kol kas tik vizualinė reakcija), ir broadcast'ina
  // "boss_attack" kad klientai sinchroniškai parodytų boso smūgį bei pataikytus žaidėjus.
  private doBossAttack() {
    if (this.state.status !== "active") return;

    const now        = Date.now();
    const sessionIds = Array.from(this.state.players.keys());

    const hits: Array<{ sid: string; dmg: number; blocked: boolean; hp: number; downed: boolean }> = [];
    if (sessionIds.length > 0) {
      // Fisher–Yates dalinis maišymas — paimame iki bossMaxTargets() pirmų
      for (let i = sessionIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sessionIds[i], sessionIds[j]] = [sessionIds[j], sessionIds[i]];
      }
      const count  = Math.min(bossMaxTargets(this.bossKind), sessionIds.length);
      const picked = sessionIds.slice(0, count);
      const rawDmg = bossAttackDamage(this.bossKind, this.state.phase);

      picked.forEach((sid) => {
        const p = this.state.players.get(sid);
        if (!p || p.state === STATE.DOWNED || p.state === STATE.DEAD) return;
        // Group A: bosas visada dešinėj, tad block (laikant) gina nepriklausomai nuo
        // krypties — vengia "skydas rodomas bet neblokuoja". Block mažina žalą per
        // shared resolveDamage (kaip Arena), bet pilnai neatremia.
        const blocked = p.blocking;
        const dmg = resolveDamage(rawDmg, {
          blocked,
          defendReduction: p.defendReduction,
          blockReduction: classGuard(p.characterClass).block_reduction, // per-klasę iš battle_classes.json
        });
        p.hp = Math.max(0, p.hp - dmg);

        if (p.hp <= 0) {
          // Nokautas — atsigauna po REVIVE_MS (tick() atstato HP).
          // downedUntil saugo revive laiką pagal userId → persist'ina per leave/rejoin.
          p.state         = STATE.DOWNED;
          p.stateUntil    = now + REVIVE_MS;
          p.reviveSeconds = Math.ceil(REVIVE_MS / 1000);
          p.blocking      = false;
          DOWNED_UNTIL.set(p.userId, p.stateUntil);
        } else if (!blocked) {
          p.state      = STATE.HIT;
          p.stateUntil = now + HIT_STATE_MS;
        }
        hits.push({ sid, dmg, blocked, hp: p.hp, downed: p.hp <= 0 });
      });
    }

    // Visiems klientams — boso smūgio animacija + per-target rezultatai (žala/block/downed)
    this.broadcast("boss_attack", { phase: this.state.phase, targets: hits });

    this.scheduleBossAttack();
  }

  // ── Syncinam pradinį state iš FastAPI ───────────────────────────────────────
  private async syncFromFastApi() {
    if (!this.state) return;
    try {
      const res = await axios.get(`${FASTAPI_URL}/api/boss-raid/internal/active-state`, {
        headers: INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {},
        timeout: 5000,
      });
      const d = res.data;
      if (!d || !d.id) {
        console.log("[BossRaidRoom] No active raid found in FastAPI");
        return;
      }
      this.state.raidId    = String(d.id);
      this.state.bossName  = String(d.name || "Boss");
      // Forward-compatible: backend dar nesiunčia `kind` — krenta į DEFAULT_BOSS_KIND.
      // Kai pridės, boss combat parametrai automatiškai persijungia (BOSS REGISTRY).
      this.bossKind        = String(d.kind || DEFAULT_BOSS_KIND);
      this.state.currentHp = Number(d.current_hp ?? 1000);
      this.state.maxHp     = Number(d.max_hp     ?? 1000);
      this.state.phase     = Number(d.phase      ?? 1);
      this.state.status    = String(d.status     ?? "active");
      console.log(`[BossRaidRoom] Synced raid "${this.state.bossName}" HP ${this.state.currentHp}/${this.state.maxHp}`);
    } catch (err: any) {
      console.warn("[BossRaidRoom] Could not sync from FastAPI:", err?.message);
    }
  }

  // ── Raid liveness (Phase 6) ──────────────────────────────────────────────────
  // Patikrina ar mūsų raid'as vis dar yra aktyvus FastAPI pusėje. Jei jis dingo
  // arba pakeistas nauju bosu (t.y. mūsų raid'as "expired" pagal laiką), užbaigiame.
  private async checkRaidLiveness() {
    if (this.state.status !== "active" || !this.state.raidId) return;
    try {
      const res = await axios.get(`${FASTAPI_URL}/api/boss-raid/internal/active-state`, {
        headers: INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {},
        timeout: 5000,
        validateStatus: () => true, // 404 = nėra aktyvaus raid'o, tvarkome patys
      });
      const stillActive =
        res.status === 200 && res.data?.id && String(res.data.id) === this.state.raidId;
      if (stillActive) return; // viskas gerai — mūsų raid'as vis dar aktyvus
      await this.endRaidByExpiration();
    } catch (err: any) {
      // Tinklo klaida — nieko nedarom, bandysim kitą poll'ą
      console.warn("[BossRaidRoom] Liveness check failed:", err?.message);
    }
  }

  // Užbaigia raid'ą kaip "expired": sustabdo timer'ius, paima settled rewards iš
  // FastAPI ir broadcast'ina raid_finished tuo pačiu kanalu kaip ir defeat atveju.
  private async endRaidByExpiration() {
    if (this.state.status !== "active") return; // jau pasibaigęs (pvz. defeated)
    this.state.status = "expired";
    if (this.bossAttackTimer) { this.bossAttackTimer.clear?.(); this.bossAttackTimer = null; }
    if (this.resyncTimer)     { this.resyncTimer.clear?.();     this.resyncTimer = null; }
    this.lock(); // nauji žaidėjai nebepateks į pasibaigusį room'ą (žr. defeat komentarą)
    console.log(`[BossRaidRoom] Raid expired, raidId=${this.state.raidId}`);

    let rewards: any[] = [];
    let bossName = this.state.bossName;
    let status   = "expired";
    try {
      const res = await axios.get(
        `${FASTAPI_URL}/api/boss-raid/internal/raid-result/${this.state.raidId}`,
        { headers: INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {}, timeout: 5000 }
      );
      if (Array.isArray(res.data?.rewards)) rewards = res.data.rewards;
      if (res.data?.boss_name) bossName = res.data.boss_name;
      if (res.data?.status)    status   = res.data.status;
    } catch (err: any) {
      console.warn("[BossRaidRoom] Could not fetch raid result:", err?.message);
    }

    this.broadcast("raid_finished", { boss_name: bossName, status, rewards });
  }

  // ── Išsaugome damage į DB per FastAPI ────────────────────────────────────────
  private async persistDamage(userId: string, damage: number) {
    if (!this.state.raidId) return;
    await axios.post(
      `${FASTAPI_URL}/api/boss-raid/internal/record-damage`,
      { raid_id: this.state.raidId, user_id: userId, damage },
      {
        headers: INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {},
        timeout: 3000,
      }
    );
  }

  // ── Pranešame FastAPI kad bosas nugalėtas, gauname rewards ir broadcast'iname ──
  private async notifyFastApiDefeated() {
    if (!this.state.raidId) return;
    const res = await axios.post(
      `${FASTAPI_URL}/api/boss-raid/internal/defeat`,
      { raid_id: this.state.raidId },
      {
        headers: INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {},
        timeout: 5000,
      }
    );

    // Broadcast rewards to every client in this room so they can show the loot screen.
    // FastAPI has already written rewards to DB — this is notification only.
    const { rewards, boss_name } = res.data ?? {};
    if (Array.isArray(rewards) && rewards.length > 0) {
      this.broadcast("raid_finished", {
        boss_name: boss_name || this.state.bossName,
        status:    "defeated",
        rewards,
      });
    }
  }
}
