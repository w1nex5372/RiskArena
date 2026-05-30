import "reflect-metadata";
import { Room, Client } from "colyseus";
import axios from "axios";
import { BossRaidState, RaidPlayer } from "../schemas/BossRaidState";

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
} as const;

const ATTACK_STATE_MS = 400; // kiek laiko žaidėjas lieka "attacking" po smūgio
const HIT_STATE_MS    = 500; // kiek laiko žaidėjas lieka "hit" kai bosas pataiko
const SIM_TICK_MS     = 100; // kas kiek tikriname ar transient būsenos pasibaigė

// Boso atakos dažnis pagal fazę [minMs, maxMs] — kuo žemesnė boso HP, tuo agresyviau
const BOSS_ATTACK_CADENCE: Record<number, [number, number]> = {
  1: [2800, 5000],
  2: [2000, 3500],
  3: [1200, 2400],
};
const BOSS_MAX_TARGETS = 3; // kiek žaidėjų bosas gali pataikyti vienu smūgiu

// ── Movement model (Phase 5) ──────────────────────────────────────────────────
// Pozicija yra grynai kosmetinė (neturi įtakos damage'ui), todėl ji client-authoritative:
// klientas siunčia savo x, serveris tik apkarpo į ribas ir saugo. Anti-cheat čia nereikia.
const MOVE_MIN_X = 30;
const MOVE_MAX_X = 390;
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

  // ── Room kūrimas ────────────────────────────────────────────────────────────
  async onCreate(options: any) {
    this.setState(new BossRaidState());

    // Bandome užkrauti aktyvų raid'ą iš FastAPI
    await this.syncFromFastApi();

    // "attack" žinutė ateina kai žaidėjas paspaudžia attack mygtuką
    this.onMessage("attack", (client) => this.handleAttack(client));

    // "move" — klientas praneša savo poziciją (Phase 5). Serveris apkarpo ir saugo.
    this.onMessage("move", (client, msg) => this.handleMove(client, msg));

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

    // Server-side cooldown — klientas negali apgauti siųsdamas žinutes greičiau
    const now = Date.now();
    if (now - player.lastAttackAt < ATTACK_COOLDOWN_MS) return;
    player.lastAttackAt = now;

    // Damage skaičiavimas (Phase 1: be item bonusų — pridėsime vėliau)
    const damage = rollDamage();

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

    // Bosas nugalėtas
    if (newHp <= 0 && this.state.status === "active") {
      this.state.status = "defeated";
      if (this.bossAttackTimer) { this.bossAttackTimer.clear?.(); this.bossAttackTimer = null; }
      if (this.resyncTimer)     { this.resyncTimer.clear?.();     this.resyncTimer = null; }
      // Užrakiname room'ą — nauji žaidėjai (joinOrCreate) nebepateks į pasibaigusį
      // raid'ą; jiems bus sukurtas naujas room'as, kuris pasiims naują bosą.
      this.lock();
      console.log(`[BossRaidRoom] Boss defeated! raidId=${this.state.raidId}`);

      // Pranešame FastAPI kad settler'intų rewards
      // (Phase 1: tik log'inam — rewards migration bus vėliau)
      this.notifyFastApiDefeated().catch((err) =>
        console.warn("[BossRaidRoom] Failed to notify FastAPI of defeat:", err?.message)
      );
    }

    // DB'e išsaugome damage (per FastAPI) — async, neblokuoja room'o
    this.persistDamage(player.userId, damage).catch((err) =>
      console.warn("[BossRaidRoom] Failed to persist damage:", err?.message)
    );
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

  // ── Simulation tick — transient būsenų gyvavimo laikas ───────────────────────
  // Kas SIM_TICK_MS tikriname kiekvieną žaidėją: jei jo attacking/hit būsena
  // pasibaigė (now >= stateUntil), grąžiname į idle. Vienintelė vieta kur
  // transient būsenos baigiasi — laikymas serveryje => visi klientai mato vienodai.
  private tick() {
    const now = Date.now();
    this.state.players.forEach((p) => {
      if (p.state === STATE.DEAD) return; // dead yra terminalinė
      if (p.stateUntil > 0 && now >= p.stateUntil && p.state !== STATE.IDLE) {
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
    const [minMs, maxMs] = BOSS_ATTACK_CADENCE[this.state.phase] ?? BOSS_ATTACK_CADENCE[1];
    const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
    this.bossAttackTimer = this.clock.setTimeout(() => this.doBossAttack(), delay);
  }

  // Bosas atakuoja: pasirenka iki BOSS_MAX_TARGETS atsitiktinių prisijungusių žaidėjų,
  // pažymi juos "hit" būsena (be HP — kol kas tik vizualinė reakcija), ir broadcast'ina
  // "boss_attack" kad klientai sinchroniškai parodytų boso smūgį bei pataikytus žaidėjus.
  private doBossAttack() {
    if (this.state.status !== "active") return;

    const now        = Date.now();
    const sessionIds = Array.from(this.state.players.keys());

    let targets: string[] = [];
    if (sessionIds.length > 0) {
      // Fisher–Yates dalinis maišymas — paimame iki BOSS_MAX_TARGETS pirmų
      for (let i = sessionIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sessionIds[i], sessionIds[j]] = [sessionIds[j], sessionIds[i]];
      }
      const count = Math.min(BOSS_MAX_TARGETS, sessionIds.length);
      targets = sessionIds.slice(0, count);

      targets.forEach((sid) => {
        const p = this.state.players.get(sid);
        if (!p || p.state === STATE.DEAD) return;
        p.state      = STATE.HIT;
        p.stateUntil = now + HIT_STATE_MS;
      });
    }

    // Visiems klientams — kad boso smūgio animacija būtų vienoda visiems ekranuose
    this.broadcast("boss_attack", { phase: this.state.phase, targets });

    this.scheduleBossAttack();
  }

  // ── Syncinam pradinį state iš FastAPI ───────────────────────────────────────
  private async syncFromFastApi() {
    if (!this.state) return;
    try {
      const res = await axios.get(`${FASTAPI_URL}/boss-raid/internal/active-state`, {
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
      const res = await axios.get(`${FASTAPI_URL}/boss-raid/internal/active-state`, {
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
        `${FASTAPI_URL}/boss-raid/internal/raid-result/${this.state.raidId}`,
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
      `${FASTAPI_URL}/boss-raid/internal/record-damage`,
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
      `${FASTAPI_URL}/boss-raid/internal/defeat`,
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
