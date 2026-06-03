// ─────────────────────────────────────────────────────────────────────────────
// Shared boss metadata — vienintelis šaltinis boss combat parametrams (BOSS REGISTRY).
// Naujas bosas pridedamas TIK įrašant naują entry į shared/boss_definitions.json
// (+ vėliau sprite asset) — JOKIŲ pakeitimų BossRaidRoom.ts. Room tik APPLY'ina
// reikšmes; jokių dubliuotų boss lentelių niekur kitur.
//
// Kiekvienas bosas turi `attacks` MASYVĄ — kiekvienas elementas yra atskira ataka
// (melee / aoe) su savo žala, telegraph'u, weight'u ir blockable vėliava. Room'as
// kiekvieno smūgio metu pasirenka ataką per pickBossAttack() (weighted-random).
// ─────────────────────────────────────────────────────────────────────────────

// Vienos boso atakos tipas — 'melee' (blokuojama, range targets) arba 'aoe'
// (neblokuojama, visi present žaidėjai; dodge'inama TIK šuoliu — žr. BossRaidRoom).
export type BossAttackType = "melee" | "aoe";

// Viena boso ataka iš `attacks` masyvo.
export type BossAttack = {
  id: string;                                    // atakos identifikatorius (pvz. "swipe"/"slam")
  type: BossAttackType;                          // 'melee' | 'aoe'
  weight: number;                                // weighted-random svoris (default 1)
  telegraph_ms: number;                          // windup trukmė ms prieš smūgio landing
  blockable: boolean;                            // ar block/guard mažina žalą (aoe → false)
  max_targets: number;                           // kiek žaidėjų pataiko (tik melee aktualu)
  damage_by_phase: Record<string, number>;       // žala pagal fazę (raktas "1"/"2"/"3")
};

export type BossDef = {
  label?: string;
  sprite?: string;
  hp_per_level?: number;
  hit_x: number;
  attacks: BossAttack[];
  // Boso atakos dažnis pagal fazę [minMs, maxMs] — bendras visoms atakoms
  cadence_by_phase: Record<string, [number, number]>;
};

// Numatytasis bosas — atsarga jei `kind` nežinomas/dar neperduotas backend'o.
export const DEFAULT_BOSS_KIND = "wartotaur";

// Saugios atsargos — reikšmės LYGIOS buvusiems hardcoded skaičiams BossRaidRoom.ts.
// Naudojamos kai entry'je trūksta lauko (forward-compatible merge).
const DEFAULT_CADENCE: Record<string, [number, number]> = {
  "1": [2800, 5000], "2": [2000, 3500], "3": [1200, 2400],
};
// Atsarginė ataka — IDENTIŠKA buvusiam wartotaur melee (8/14/22, 3 targets).
// Naudojama jei bosas neturi `attacks` masyvo (forward/back-compatible).
const DEFAULT_ATTACK: BossAttack = {
  id: "swipe",
  type: "melee",
  weight: 3,
  telegraph_ms: 450,
  blockable: true,
  max_targets: 3,
  damage_by_phase: { "1": 8, "2": 14, "3": 22 },
};
const DEFAULT_HIT_X = 500;
const DEFAULT_MAX_TARGETS = 3;

// Raw entry forma JSON'e (prieš normalizavimą) — atskiri laukai gali trūkti.
type RawBossDef = Partial<Omit<BossDef, "attacks">> & {
  attacks?: Array<Partial<BossAttack>>;
};

// Reikšmingas: kelias toks pat kaip classes.ts/abilities.ts — iš src/shared/ jis
// išsisprendžia į repo-root shared/ failą.
const BOSS_DEFINITIONS =
  (require("../../../shared/boss_definitions.json").bosses || {}) as Record<string, RawBossDef>;

// Normalizuoja kind: lowercase + trim; nežinomas → DEFAULT_BOSS_KIND.
export function normalizeBossKind(kind: string, fallback = DEFAULT_BOSS_KIND): string {
  const normalized = String(kind || "").trim().toLowerCase();
  return BOSS_DEFINITIONS[normalized] ? normalized : fallback;
}

// Sumerge'ina vieną raw atakos entry su saugiais default'ais (forward-compatible).
function normalizeAttack(raw: Partial<BossAttack> | undefined): BossAttack {
  const a = raw || {};
  const type: BossAttackType = a.type === "aoe" ? "aoe" : "melee";
  return {
    id: String(a.id ?? DEFAULT_ATTACK.id),
    type,
    weight: Number.isFinite(Number(a.weight)) && Number(a.weight) > 0 ? Number(a.weight) : 1,
    telegraph_ms: Number.isFinite(Number(a.telegraph_ms)) ? Number(a.telegraph_ms) : DEFAULT_ATTACK.telegraph_ms,
    // type nustato default'ą: aoe neblokuojama, melee blokuojama — nebent JSON pasako kitaip.
    blockable: typeof a.blockable === "boolean" ? a.blockable : type !== "aoe",
    max_targets: Number.isFinite(Number(a.max_targets)) ? Number(a.max_targets) : DEFAULT_MAX_TARGETS,
    damage_by_phase: {
      ...DEFAULT_ATTACK.damage_by_phase,
      ...(a.damage_by_phase || {}),
    },
  };
}

// Grąžina pilną BossDef su sumerge'intais default'ais — kiekvienas trūkstamas
// laukas turi saugią atsargą (lygią buvusiems hardcoded skaičiams).
export function bossDef(kind: string): BossDef {
  const key = normalizeBossKind(kind);
  const def = BOSS_DEFINITIONS[key] || {};
  const rawAttacks = Array.isArray(def.attacks) && def.attacks.length > 0
    ? def.attacks
    : [DEFAULT_ATTACK];
  return {
    label: def.label,
    sprite: def.sprite,
    hp_per_level: def.hp_per_level,
    hit_x: Number(def.hit_x ?? DEFAULT_HIT_X),
    attacks: rawAttacks.map(normalizeAttack),
    cadence_by_phase: {
      ...DEFAULT_CADENCE,
      ...(def.cadence_by_phase || {}),
    },
  };
}

// ── Atakos pasirinkimas ──────────────────────────────────────────────────────
// Weighted-random ataka iš boso `attacks` masyvo. Weight'as nustato dažnį
// (pvz. swipe weight 3 vs slam weight 1 → swipe ~75% laiko). Visada grąžina ataką.
export function pickBossAttack(kind: string): BossAttack {
  const attacks = bossDef(kind).attacks;
  if (attacks.length === 1) return attacks[0];
  const totalWeight = attacks.reduce((sum, a) => sum + (a.weight > 0 ? a.weight : 1), 0);
  let roll = Math.random() * totalWeight;
  for (const a of attacks) {
    roll -= a.weight > 0 ? a.weight : 1;
    if (roll < 0) return a;
  }
  return attacks[attacks.length - 1]; // floating-point atsarga
}

// ── Per-atakos accessoriai (priima atakos objektą, ne kind) ──────────────────

// Atakos žala pagal fazę (1/2/3). Trūkstama fazė → fazės 1 reikšmė.
export function attackDamage(attack: BossAttack, phase: number): number {
  const dmg = attack.damage_by_phase;
  const value = Number(dmg[String(phase)] ?? dmg["1"]);
  return Number.isFinite(value) ? value : DEFAULT_ATTACK.damage_by_phase["1"];
}

// Telegraph (windup) trukmė ms prieš smūgio landing.
export function attackTelegraphMs(attack: BossAttack): number {
  const ms = Number(attack.telegraph_ms);
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_ATTACK.telegraph_ms;
}

// Kiek žaidėjų pataiko (aktualu tik melee atakai). Default 3.
export function attackMaxTargets(attack: BossAttack): number {
  const n = Number(attack.max_targets);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TARGETS;
}

// Atakos tipas — 'melee' | 'aoe'.
export function attackType(attack: BossAttack): BossAttackType {
  return attack.type === "aoe" ? "aoe" : "melee";
}

// Ar atakos žalą mažina block/guard (aoe → false: neblokuojama).
export function attackBlockable(attack: BossAttack): boolean {
  return !!attack.blockable;
}

// ── Per-boso accessoriai ─────────────────────────────────────────────────────

// Boso atakos dažnis [minMs, maxMs] pagal fazę (1/2/3). Trūkstama fazė → fazės 1.
export function bossAttackCadence(kind: string, phase: number): [number, number] {
  const cadence = bossDef(kind).cadence_by_phase;
  return cadence[String(phase)] ?? cadence["1"] ?? DEFAULT_CADENCE["1"];
}

// Boso "hit" pozicija X — naudojama žaidėjo range patikrai.
export function bossHitX(kind: string): number {
  return bossDef(kind).hit_x;
}
