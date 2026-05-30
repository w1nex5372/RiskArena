// ─────────────────────────────────────────────────────────────────────────────
// Shared combat sprite / animation contracts (Phase 7)
//
// Single source of truth for the LPC character sprite layout, animation rows
// (idle / walk / attack / hurt / dead / jump), class metadata and held-weapon
// poses. Both BattleScene (Arena 1v1) and BossRaidScene import from here so the
// two combat modes stay visually identical — change a frame rate or a jump row
// once and both modes update.
//
// NOTE: This unifies the *client-side rendering* contract only. The server-side
// wire state strings still differ per mode (Arena: walking/hurt/blocking,
// BossRaid: moving/hit) — STATE_ANIM below normalizes both vocabularies into the
// same animation names, so a single rendering path serves both.
// ─────────────────────────────────────────────────────────────────────────────

// Battle canvas dimensions (shared by both scenes)
export const W       = 800;
export const H       = 420;
export const FLOOR_Y = 360;

// LPC sprite render constants
export const SPRITE_SCALE  = 2.0;
export const SPRITE_HEIGHT = 64 * SPRITE_SCALE; // 128px rendered height
// LPC art leaves ~6px empty at frame bottom; at 2x scale push sprite down 12px to land on floor
export const FOOT_OFFSET   = 12;

// Per-class column counts — rogue sheets are 18 cols, warrior/mage are 13
export const CLASS_COLS = { warrior: 13, mage: 13, rogue: 18 };

// Build a frame-index helper for a given column count: F(row, col) → frame number
export const makeF = (cols) => (row, col) => row * cols + col;

// Animation row definitions — same rows work for all LPC sheets.
// rate = frames/sec. loop: -1 = repeat forever, 0 = play once.
export const ANIM_ROW_DEFS = {
  idle:   { rowFn: (F) => [F(11, 0)],                                    rate: 1,  loop: -1 },
  walk:   { rowFn: (F) => Array.from({ length: 9 }, (_, i) => F(11, i)), rate: 9,  loop: -1 },
  attack: { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(15, i)), rate: 12, loop: 0  },
  hurt:   { rowFn: (F) => [F(20, 0), F(20, 1), F(20, 2)],               rate: 8,  loop: 0  },
  dead:   { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(20, i)), rate: 6,  loop: 0  },
  jump:   { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(4,  i)), rate: 10, loop: 0  },
};

// Normalizes a server action-state string (from either combat mode) → animation name.
// Arena emits walking/hurt/blocking/jumping; BossRaid emits moving/hit — both map here.
export const STATE_ANIM = {
  idle:      'idle',
  walking:   'walk',
  walk:      'walk',
  moving:    'walk',
  attacking: 'attack',
  attack:    'attack',
  hurt:      'hurt',
  hit:       'hurt',
  dead:      'dead',
  jumping:   'jump',
  jump:      'jump',
  blocking:  'idle',
};

// Class tint colors (hex int for Phaser, hex string for text labels)
export const CLASS_COLORS = { warrior: 0xe74c3c, mage: 0x9b59b6, rogue: 0x2ecc71 };
export const CLASS_HEX    = { warrior: '#e74c3c', mage: '#9b59b6', rogue: '#2ecc71' };

// Weapon overlay assets
export const CLASS_WEAPON      = { warrior: 'warrior_katana', mage: 'mage_staff', rogue: 'rogue_scimitar' };
export const CLASS_WEAPON_ICON = {
  warrior: '/items/icons/warrior_katana_icon.png',
  mage:    '/items/icons/mage_staff_icon.png',
  rogue:   '/items/icons/rogue_scimitar_icon.png',
};

// Per-weapon sheet column counts (width / 64)
export const WEAPON_SHEET_COLS = { warrior: 18, mage: 24, rogue: 18 };

// LPC weapon overlay rows. For the idle pose row 65 col 2 gives a readable held weapon.
export const WEAPON_ANIM_ROWS = {
  warrior: { idle: 65, idleCol: 2, walk: 57, walkStartCol: 0, walkFrames: 9, attack: 65, attackFrames: 6, hurt: 68, dead: 69 },
  mage:    { idle: 11, idleCol: 0, walk: 11, walkFrames: 9, attack: 64, attackCols: [1, 4, 7], hurt: 20, dead: 20 },
  rogue:   { idle: 65, idleCol: 2, walk: 57, walkStartCol: 0, walkFrames: 9, attack: 65, attackFrames: 6, hurt: 68, dead: 69 },
};

// Held-weapon pose offsets per class (for the icon-based held weapon overlay)
export const HELD_WEAPON_POSE = {
  warrior: { xOff: 21, yOff: -50, scale: 0.105, rotation: -25 },
  mage:    { xOff: 17, yOff: -45, scale: 0.100, rotation: -26 },
  rogue:   { xOff: 22, yOff: -42, scale: 0.100, rotation: -35 },
};
