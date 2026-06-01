// ─────────────────────────────────────────────────────────────────────────────
// Shared combat rules — single source of truth for damage/block math.
// Used by BOTH ArenaRoom (PvP) and BossRaidRoom (co-op vs boss) so the two modes
// share identical defense/damage behavior. Each room owns only the context:
//   - damage SOURCE  (Arena: opponent ability/attack; Boss: boss attack)
//   - on-death       (Arena: end match; Boss: downed + revive)
// ─────────────────────────────────────────────────────────────────────────────

export { classMaxHp } from "./classes";

// Active (held) block reduces incoming damage by this fraction.
export const ACTIVE_BLOCK_REDUCTION = 0.65;

// Pure damage resolution — mirrors the Arena dealDamageAt math exactly.
//   blocked          = the hit was actively blocked (caller decides directional + ignoreBlock)
//   defendReduction  = passive armor reduction (0..1)
export function resolveDamage(
  rawDmg: number,
  opts: { blocked?: boolean; defendReduction?: number; blockReduction?: number } = {},
): number {
  const passive = 1 - (opts.defendReduction ?? 0);
  const blockReduction = opts.blockReduction ?? ACTIVE_BLOCK_REDUCTION;
  const block   = opts.blocked ? 1 - blockReduction : 1;
  return Math.max(1, Math.round(rawDmg * passive * block));
}
