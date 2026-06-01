// Shared class metadata for server-authoritative arena combat.
// New classes should be added in shared/battle_classes.json, then consumed here.

type BasicAttackMeta = {
  range: number;
  damage_min: number;
  damage_max: number;
  cooldown_ms: number;
  backstab_multiplier?: number;
};

type GuardMeta = {
  max: number;
  hold_drain_per_tick: number;
  regen_per_tick: number;
  regen_delay_ms: number;
  hit_drain_mult: number;
  break_stun_ms: number;
  break_recover_ms: number;
  block_reduction: number;
};

type ClassMeta = {
  label?: string;
  title?: string;
  role?: string;
  role_description?: string;
  base_hp: number;
  move_speed: number;
  default_ability_key: string;
  basic_attack: BasicAttackMeta;
  guard: GuardMeta;
  passives?: string[];
};

const DEFAULT_BASIC_ATTACK: BasicAttackMeta = {
  range: 90,
  damage_min: 15,
  damage_max: 25,
  cooldown_ms: 600,
};

const DEFAULT_GUARD: GuardMeta = {
  max: 100,
  hold_drain_per_tick: 0.8,
  regen_per_tick: 2.4,
  regen_delay_ms: 750,
  hit_drain_mult: 1.35,
  break_stun_ms: 850,
  break_recover_ms: 1000,
  block_reduction: 0.65,
};

const BATTLE_CLASS_METADATA =
  (require("../../../shared/battle_classes.json").classes || {}) as Record<string, Partial<ClassMeta>>;

export function normalizeClassName(className: string, fallback = "warrior"): string {
  const normalized = String(className || "").trim().toLowerCase();
  return BATTLE_CLASS_METADATA[normalized] ? normalized : fallback;
}

export function classMeta(className: string): ClassMeta {
  const key = normalizeClassName(className);
  const meta = BATTLE_CLASS_METADATA[key] || {};
  return {
    ...meta,
    base_hp: Number(meta.base_hp ?? 100),
    move_speed: Number(meta.move_speed ?? 8),
    default_ability_key: String(meta.default_ability_key || `${key}_default`),
    basic_attack: {
      ...DEFAULT_BASIC_ATTACK,
      ...(meta.basic_attack || {}),
    },
    guard: {
      ...DEFAULT_GUARD,
      ...(meta.guard || {}),
    },
  };
}

export function classMaxHp(className: string): number {
  return classMeta(className).base_hp;
}

export function classMoveSpeed(className: string): number {
  return classMeta(className).move_speed;
}

export function classDefaultAbilityKey(className: string): string {
  return classMeta(className).default_ability_key;
}

export function classBasicAttack(className: string): BasicAttackMeta {
  return classMeta(className).basic_attack;
}

export function classGuard(className: string): GuardMeta {
  return classMeta(className).guard;
}

export function classPassives(className: string): string[] {
  return classMeta(className).passives || [];
}
