// ─────────────────────────────────────────────────────────────────────────────
// Shared ability metadata — single source of truth for ability data/damage.
// Used by BOTH ArenaRoom (PvP) and BossRaidRoom (co-op vs boss) so the two modes
// read ability stats from the SAME shared/battle_abilities.json. No duplicated
// ability tables anywhere — each room only owns how it APPLIES the resolved values.
// ─────────────────────────────────────────────────────────────────────────────

export type AbilityMeta = {
  class?: string;
  type?: string;
  damage?: number;
  ability_power_scale?: number;
  stun_ms?: number;
  knockback?: number;
  blocked_knockback_mult?: number;
  range?: number;
  offset?: number;
  cooldown_ms?: number;
  ignore_block?: boolean;
};

// Reikšmingas: kelias toks pat kaip ArenaRoom naudojo anksčiau — iš src/shared/ ir
// iš src/rooms/ (vienodas gylis) jis išsisprendžia į repo-root shared/ failą.
const BATTLE_ABILITY_METADATA =
  (require("../../../shared/battle_abilities.json").abilities || {}) as Record<string, AbilityMeta>;

export function abilityMeta(abilityKey: string): AbilityMeta | null {
  if (!abilityKey) return null;
  return BATTLE_ABILITY_METADATA[abilityKey] || null;
}

export function abilityNumber(meta: AbilityMeta | null, key: keyof AbilityMeta, fallback: number): number {
  const value = Number(meta?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function abilityCooldownMs(abilityKey: string, fallback = 0): number {
  return abilityNumber(abilityMeta(abilityKey), "cooldown_ms", fallback);
}

export function abilityAllowedForClass(className: string, abilityKey: string): boolean {
  const cls = String(className || "").toLowerCase();
  const meta = abilityMeta(abilityKey);
  return !!(cls && meta?.class && String(meta.class).toLowerCase() === cls);
}
