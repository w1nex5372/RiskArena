// ─────────────────────────────────────────────────────────────────────────────
// Shared boss metadata — vienintelis šaltinis boss combat parametrams (BOSS REGISTRY).
// Naujas bosas pridedamas TIK įrašant naują entry į shared/boss_definitions.json
// (+ vėliau sprite asset) — JOKIŲ pakeitimų BossRaidRoom.ts. Room tik APPLY'ina
// reikšmes; jokių dubliuotų boss lentelių niekur kitur.
// ─────────────────────────────────────────────────────────────────────────────

type BossAttackMeta = {
  // Boso atakos žala pagal fazę (raktas "1"/"2"/"3")
  damage_by_phase: Record<string, number>;
  // Boso atakos dažnis pagal fazę [minMs, maxMs]
  cadence_by_phase: Record<string, [number, number]>;
};

export type BossDef = {
  label?: string;
  sprite?: string;
  hp_per_level?: number;
  hit_x: number;
  max_targets: number;
  attack: BossAttackMeta;
};

// Numatytasis bosas — atsarga jei `kind` nežinomas/dar neperduotas backend'o.
export const DEFAULT_BOSS_KIND = "wartotaur";

// Saugios atsargos — reikšmės LYGIOS buvusiems hardcoded skaičiams BossRaidRoom.ts.
// Naudojamos kai entry'je trūksta lauko (forward-compatible merge).
const DEFAULT_ATTACK: BossAttackMeta = {
  damage_by_phase: { "1": 8, "2": 14, "3": 22 },
  cadence_by_phase: { "1": [2800, 5000], "2": [2000, 3500], "3": [1200, 2400] },
};
const DEFAULT_HIT_X = 500;
const DEFAULT_MAX_TARGETS = 3;

// Reikšmingas: kelias toks pat kaip classes.ts/abilities.ts — iš src/shared/ jis
// išsisprendžia į repo-root shared/ failą.
const BOSS_DEFINITIONS =
  (require("../../../shared/boss_definitions.json").bosses || {}) as Record<string, Partial<BossDef>>;

// Normalizuoja kind: lowercase + trim; nežinomas → DEFAULT_BOSS_KIND.
export function normalizeBossKind(kind: string, fallback = DEFAULT_BOSS_KIND): string {
  const normalized = String(kind || "").trim().toLowerCase();
  return BOSS_DEFINITIONS[normalized] ? normalized : fallback;
}

// Grąžina pilną BossDef su sumerge'intais default'ais — kiekvienas trūkstamas
// laukas turi saugią atsargą (lygią buvusiems hardcoded skaičiams).
export function bossDef(kind: string): BossDef {
  const key = normalizeBossKind(kind);
  const def = BOSS_DEFINITIONS[key] || {};
  const attack: Partial<BossAttackMeta> = def.attack || {};
  return {
    ...def,
    hit_x: Number(def.hit_x ?? DEFAULT_HIT_X),
    max_targets: Number(def.max_targets ?? DEFAULT_MAX_TARGETS),
    attack: {
      damage_by_phase: {
        ...DEFAULT_ATTACK.damage_by_phase,
        ...(attack.damage_by_phase || {}),
      },
      cadence_by_phase: {
        ...DEFAULT_ATTACK.cadence_by_phase,
        ...(attack.cadence_by_phase || {}),
      },
    },
  };
}

// Boso atakos žala pagal fazę (1/2/3). Trūkstama fazė → fazės 1 reikšmė.
export function bossAttackDamage(kind: string, phase: number): number {
  const dmg = bossDef(kind).attack.damage_by_phase;
  const value = Number(dmg[String(phase)] ?? dmg["1"]);
  return Number.isFinite(value) ? value : DEFAULT_ATTACK.damage_by_phase["1"];
}

// Boso atakos dažnis [minMs, maxMs] pagal fazę (1/2/3). Trūkstama fazė → fazės 1.
export function bossAttackCadence(kind: string, phase: number): [number, number] {
  const cadence = bossDef(kind).attack.cadence_by_phase;
  return cadence[String(phase)] ?? cadence["1"] ?? DEFAULT_ATTACK.cadence_by_phase["1"];
}

// Kiek žaidėjų bosas pataiko vienu smūgiu.
export function bossMaxTargets(kind: string): number {
  return bossDef(kind).max_targets;
}

// Boso "hit" pozicija X — naudojama žaidėjo range patikrai.
export function bossHitX(kind: string): number {
  return bossDef(kind).hit_x;
}
