// ─────────────────────────────────────────────────────────────────────────────
// Shared combat movement/jump tuning — single source of truth for "feel".
//
// These values mirror ArenaRoom's server-side combat feel: snappy 120 px/s walk
// and the taller Arena jump arc. BossRaid uses this file directly; Arena's
// horizontal/jump physics still live server-side, so keep ArenaRoom constants in
// sync when tuning.
// ─────────────────────────────────────────────────────────────────────────────

// Horizontal walk speed (px per second)
export const MOVE_SPEED_PX_S = 120;

// Jump arc derived from ArenaRoom: JUMP_VELOCITY=-20, GRAVITY=1.5 at ~15 FPS.
export const JUMP_HEIGHT_PX   = 125;    // peak height above the ground
export const JUMP_RISE_MS     = 860;    // time to reach the peak; full airtime is roughly 2x
export const JUMP_EASE        = 'Power2';
export const JUMP_COOLDOWN_MS = 800;
