// ─────────────────────────────────────────────────────────────────────────────
// Shared combat movement/jump tuning — single source of truth for "feel".
//
// These are the original BossRaid client values (the feel the team liked as the
// default): snappy 120 px/s walk and a low/fast jump. Both scenes read from here so
// movement stays consistent. Change a value once and every mode that consumes it
// updates. NOTE: Arena's horizontal speed lives server-side (ArenaRoom PLAYER_SPEED);
// keep it in sync with MOVE_SPEED_PX_S if Arena should match.
// ─────────────────────────────────────────────────────────────────────────────

// Horizontal walk speed (px per second)
export const MOVE_SPEED_PX_S = 120;

// Jump arc — low + fast (original BossRaid feel)
export const JUMP_HEIGHT_PX   = 60;     // peak height above the ground
export const JUMP_RISE_MS      = 210;   // time to reach the peak (one way; full airtime = 2×)
export const JUMP_EASE         = 'Power2';
export const JUMP_COOLDOWN_MS  = 0;     // 0 = no cooldown (the in-air guard prevents double-jump)
