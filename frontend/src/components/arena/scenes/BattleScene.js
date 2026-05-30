import Phaser from 'phaser';

// Shared combat sprite/animation contracts — single source of truth (Phase 7)
import {
  W, H, FLOOR_Y, CLASS_COLS, makeF, ANIM_ROW_DEFS, STATE_ANIM,
  SPRITE_SCALE, SPRITE_HEIGHT, FOOT_OFFSET,
  CLASS_COLORS, CLASS_HEX, CLASS_WEAPON, CLASS_WEAPON_ICON,
  WEAPON_SHEET_COLS, WEAPON_ANIM_ROWS, HELD_WEAPON_POSE,
} from '../combatSprites';
// Shared skill VFX — single source of truth (also used by BossRaidScene)
import { showGuardBreak, showBash, showFireball, showBlink } from '../combatEffects';

const WEAPON_DEBUG_STATES = ['idle', 'walk', 'attack', 'hurt', 'dead', 'jump'];

function resolveRuntimeAssetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return path;
}

// Weapon sheets are 64x64 overlays, but the exported melee frames sit high inside
// the cell. These anchors move the full overlay down into the character hand zone.
const WEAPON_ANCHOR = {
  warrior: { xOff:   0, yOff: 48 },
  mage:    { xOff:   0, yOff:  0 },
  rogue:   { xOff:   0, yOff: 44 },
};

const WEAPON_VISUAL_SCALE = {
  warrior: 1,
  mage: 1,
  rogue: 1,
};

const WEAPON_POSE_PRESETS = {
};

function getWeaponScale(cls) {
  const scale = WEAPON_VISUAL_SCALE[cls] ?? 1;
  const ySquash = cls === 'rogue' ? 0.86 : 1;
  return [SPRITE_SCALE * scale, SPRITE_SCALE * ySquash * scale];
}

// ── Enchant FX config ─────────────────────────────────────────────────────────
// +1–5  blue gradient (static glow)
// +6–7  purple (static)
// +8–9  gold/orange (pulsing)
// +10   red (fast pulse + particle trail)
const ENCHANT_FX = [
  null,                                                         // 0 — no effect
  { color: 0x99ccff, strength: 1.5, pulse: false },            // +1 light blue
  { color: 0x55aaff, strength: 2.0, pulse: false },            // +2 blue
  { color: 0x2277ff, strength: 2.5, pulse: false },            // +3 medium blue
  { color: 0x0044dd, strength: 3.0, pulse: false },            // +4 deep blue
  { color: 0x002299, strength: 3.5, pulse: false },            // +5 dark blue
  { color: 0x8800ff, strength: 4.0, pulse: false },            // +6 purple
  { color: 0xcc00ee, strength: 4.5, pulse: false },            // +7 vivid purple
  { color: 0xffaa00, strength: 4.5, pulse: true, dur: 800 },   // +8 gold pulse
  { color: 0xff6600, strength: 5.0, pulse: true, dur: 500 },   // +9 orange fast pulse
  { color: 0xff2200, strength: 5.5, pulse: true, dur: 380, trail: true }, // +10 red + particles
];

function applyEnchantFX(scene, weapon, enchant, spawnX, visualY, cls) {
  if (!weapon?.active || !weapon.preFX) return null;
  weapon.preFX.clear();
  const fx = ENCHANT_FX[Math.min(enchant, 10)];
  if (!fx) return null;

  const startStr = fx.pulse ? fx.strength * 0.45 : fx.strength;
  const glowFX = weapon.preFX.addGlow(fx.color, startStr, 0);
  if (fx.pulse) {
    scene.tweens.add({
      targets: glowFX,
      outerStrength: { from: startStr, to: fx.strength },
      yoyo: true, repeat: -1, duration: fx.dur,
    });
  }

  let trail = null;
  if (fx.trail) {
    trail = scene.add.particles(spawnX, visualY, 'smoke_particle', {
      speed: { min: 8, max: 24 },
      scale: { start: 0.22, end: 0 },
      alpha: { start: 0.35, end: 0 },
      lifespan: 400, quantity: 1,
      tint: 0xff2200, emitting: true,
    });
    trail.setDepth(3);
  }
  return trail;
}

function _spawnWhoosh(scene, x, y, facingRight) {
  const g = scene.add.graphics().setDepth(5);
  const d = facingRight ? 1 : -1;
  g.lineStyle(2.5, 0xffffff, 0.9);
  g.beginPath();
  g.moveTo(x + d * 8,  y - 28);
  g.bezierCurveTo(x + d * 34, y - 52, x + d * 56, y - 18, x + d * 42, y + 14);
  g.strokePath();
  g.lineStyle(1.5, 0xaaddff, 0.6);
  g.beginPath();
  g.moveTo(x + d * 4,  y - 22);
  g.bezierCurveTo(x + d * 26, y - 44, x + d * 48, y - 12, x + d * 36, y + 16);
  g.strokePath();
  scene.tweens.add({ targets: g, alpha: 0, duration: 200, ease: 'Power2', onComplete: () => { if (g.active) g.destroy(); } });
}

// Spectator palette (pixel crowd)
const CROWD_COLORS = [
  0xc0392b, 0x8e44ad, 0x2980b9, 0x27ae60,
  0xe67e22, 0xf39c12, 0x1abc9c, 0xe91e63,
  0xffffff, 0xbdc3c7,
];

// ─────────────────────────────────────────────────────────────────────────────

export default class BattleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BattleScene' });
    this.room            = null;
    this.mySessionId     = null;
    this.sprites         = new Map();
    this.lastPhase       = null;
    this.hitEmitter      = null;
    this.dustEmitter     = null;
    this.torchTweens     = [];
    this.sceneReady      = false;
    this._pendingRoom    = null;
    this._pendingSession = null;
    this._lastCountdown  = -1;
    this._vsObjects      = [];
    this.spectators      = [];
    this.hud             = null;
    this.weaponDebug     = null;
    this.dynamicSheetLoads = new Set();
  }

  // ── 1. Preload ─────────────────────────────────────────────────────────
  preload() {
    this._isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 600;

    this.load.on('loaderror', (file) => {
      console.warn(`[BattleScene] ${file.key} missing — using rectangle fallback`);
    });
    // Skip weapon sheets on mobile — saves ~15MB texture memory
    if (!this._isMobile) {
      ['warrior', 'mage', 'rogue'].forEach((cls) => {
        this.load.spritesheet(`${cls}_weapon`, `/items/${CLASS_WEAPON[cls]}.png`, {
          frameWidth: 64, frameHeight: 64,
        });
      });
    }
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      this.load.image(`${cls}_held_weapon`, CLASS_WEAPON_ICON[cls]);
    });

    // Handle WebGL context loss gracefully
    this.game.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[BattleScene] WebGL context lost — reloading');
      setTimeout(() => window.location.reload(), 1500);
    });
  }

  // ── 2. Create scene ────────────────────────────────────────────────────
  create() {
    try {
      this._createParticleTexture();
    this._buildArena();
    if (!this._isMobile) this._buildFloorFog();
    this._registerAnimations();
    if (!this._isMobile) this._registerWeaponAnimations();
    this._buildOverlays();
    this._buildTopHud();
    this._setupWeaponDebug();

    // Mark ready — textures guaranteed loaded by this point
    this.sceneReady = true;
    if (this._pendingRoom) {
      this._wireRoom(this._pendingRoom, this._pendingSession);
      this._pendingRoom = null;
      this._pendingSession = null;
    }
    } catch (err) {
      console.error('[BattleScene] create failed', err);
      this.sceneReady = true;
      this.add.text(W / 2, H / 2, `Battle scene failed\n${err?.message || 'Unknown error'}`, {
        fontSize: '18px',
        fontFamily: 'monospace',
        color: '#ef4444',
        align: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        padding: { x: 12, y: 10 },
      }).setOrigin(0.5).setDepth(100);
    }
  }

  // ── Particle textures ───────────────────────────────────────────────────
  _createParticleTexture() {
    // Blood drop — red circle
    const g1 = this.make.graphics({ add: false });
    g1.fillStyle(0xcc1111, 1);
    g1.fillCircle(4, 4, 4);
    g1.generateTexture('hit_particle', 8, 8);
    g1.destroy();

    // Fire spark — orange circle
    const g2 = this.make.graphics({ add: false });
    g2.fillStyle(0xff6600, 1);
    g2.fillCircle(3, 3, 3);
    g2.generateTexture('fire_particle', 6, 6);
    g2.destroy();

    // Smoke puff — cyan/white circle for rogue
    const g3 = this.make.graphics({ add: false });
    g3.fillStyle(0x00ffcc, 1);
    g3.fillCircle(4, 4, 4);
    g3.generateTexture('smoke_particle', 8, 8);
    g3.destroy();

    const g4 = this.make.graphics({ add: false });
    g4.fillStyle(0xaabbcc, 1);
    g4.fillCircle(8, 8, 8);
    g4.generateTexture('fog_particle', 16, 16);
    g4.destroy();

    // Landing dust — sandy burst when character hits the floor
    const gDust = this.make.graphics({ add: false });
    gDust.fillStyle(0xb8a878, 1);
    gDust.fillCircle(5, 5, 5);
    gDust.generateTexture('dust_particle', 10, 10);
    gDust.destroy();

    this.dustEmitter = this.add.particles(0, 0, 'dust_particle', {
      speed: { min: 25, max: 70 },
      angle: { min: 185, max: 355 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 380,
      quantity: 1,
      emitting: false,
    });
    this.dustEmitter.setDepth(2);

    this.hitEmitter = this.add.particles(0, 0, 'hit_particle', {
      speed:    { min: 80, max: 220 },
      angle:    { min: 0, max: 360 },
      scale:    { start: 1.2, end: 0 },
      alpha:    { start: 1,   end: 0 },
      lifespan: 400,
      quantity: 1,
      emitting: false,
    });
    this.hitEmitter.setDepth(4);
  }

  // ── Arena background + environment ─────────────────────────────────────
  _buildArena() {
    // Sky — layered depth gradient (far → near)
    this.add.rectangle(W / 2, H / 2,       W, H,    0x04040c);  // deepest void
    this.add.rectangle(W / 2, 160,         W, 320,  0x07071a);  // far background
    this.add.rectangle(W / 2, 230,         W, 200,  0x0a0a20);  // mid distance
    this.add.rectangle(W / 2, 300,         W, 120,  0x0d0d26);  // near ground
    this.add.rectangle(W / 2, FLOOR_Y - 10, W, 20,  0x10102c).setAlpha(0.7); // floor haze

    // ── Spectator stands (rows of pixel people) ─────────────────────────
    this._buildStands();

    // ── Stone arch / top bar ─────────────────────────────────────────────
    this.add.rectangle(W / 2, 84, W, 4,  0x1e1e40).setAlpha(0.8);

    // ── Side pillars (stone columns) ─────────────────────────────────────
    const pillarPositions = [42, 110, W - 110, W - 42];
    pillarPositions.forEach((px) => {
      // Pillar body
      this.add.rectangle(px, H / 2, 44, H, 0x1c1c2e);
      // Highlight edge
      this.add.rectangle(px - 20, H / 2, 4, H, 0x2a2a45).setAlpha(0.6);
      // Top cap
      this.add.rectangle(px, 30, 52, 20, 0x222238);
      // Base cap
      this.add.rectangle(px, FLOOR_Y + 12, 52, 24, 0x1a1a30);
    });

    // ── Torches ──────────────────────────────────────────────────────────
    const torchX = [42, 110, W - 110, W - 42];
    torchX.forEach((tx) => this._addTorch(tx, 80));

    // ── Arena floor ───────────────────────────────────────────────────────
    // Floor base
    this.add.rectangle(W / 2, FLOOR_Y + 18, W, 36, 0x16162a);
    // Floor surface (lighter strip)
    this.add.rectangle(W / 2, FLOOR_Y + 2,  W, 4,  0x20204a);
    // Gold accent line
    this.add.rectangle(W / 2, FLOOR_Y,      W, 2,  0xc9a84c).setAlpha(0.55);

    // Vertical stone tile seams on floor
    for (let x = 80; x < W; x += 80) {
      this.add.rectangle(x, FLOOR_Y + 18, 1, 36, 0x22224a).setAlpha(0.4);
    }

    // ── Subtle center glow on floor ───────────────────────────────────────
    const glow = this.add.rectangle(W / 2, FLOOR_Y + 2, 300, 6, 0xc9a84c);
    glow.setAlpha(0.06);
    this.tweens.add({
      targets: glow, alpha: { from: 0.04, to: 0.12 },
      duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // Side vignette — stepped alpha strips to darken arena edges
    [[18, 36, 0.40], [62, 52, 0.18], [112, 40, 0.07]].forEach(([cx, w, a]) => {
      this.add.rectangle(cx,     H / 2, w, H, 0x000000, a).setDepth(0);
      this.add.rectangle(W - cx, H / 2, w, H, 0x000000, a).setDepth(0);
    });

    // ARENA label
    this.add.text(W / 2, 14, 'ARENA', {
      fontSize: '13px', fontFamily: 'monospace',
      color: '#c9a84c', fontStyle: 'bold', letterSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(5);
  }

  _buildStands() {
    // Three rows of stone seating
    const rows = [
      { y: 30, rowH: 22, color: 0x0e0e20 },
      { y: 52, rowH: 20, color: 0x0c0c1c },
      { y: 72, rowH: 18, color: 0x0a0a18 },
    ];
    rows.forEach(({ y, rowH, color }) => {
      this.add.rectangle(W / 2, y, W, rowH, color);
    });

    // Pixel spectators (tiny 3×5 rectangles)
    const rng = (seed, range) => Math.floor(((seed * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff * range);
    let seed = 42;
    const spectatorCount = this._isMobile ? 30 : 90;
    for (let i = 0; i < spectatorCount; i++) {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const sx = 10 + (seed % (W - 20));
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const sy = 20 + rng(seed, 52);
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const col = CROWD_COLORS[rng(seed, CROWD_COLORS.length)];
      const sp = this.add.rectangle(sx, sy, 3, 5, col).setAlpha(0.55 + rng(seed + i, 30) / 100);
      this.spectators.push({ obj: sp, baseY: sy });
    }
  }

  _buildFloorFog() {
    this.add.particles(W / 2, FLOOR_Y - 4, 'fog_particle', {
      x: { min: -W / 2, max: W / 2 },
      y: { min: -6, max: 6 },
      speedY: { min: -12, max: -4 },
      speedX: { min: -8, max: 8 },
      scale:    { start: 1.6, end: 0 },
      alpha:    { start: 0.13, end: 0 },
      tint:     [0x8899bb, 0xaabbcc, 0x99aacc],
      lifespan: { min: 3200, max: 5500 },
      quantity: 1,
      frequency: 180,
      depth: 1,
    });
  }

  _addTorch(x, y) {
    const lightPool = this.add.circle(x, y + 60, 70, 0xff8800, 0.055);
    this.tweens.add({
      targets: lightPool,
      alpha: { from: 0.035, to: 0.085 },
      duration: 1800 + Math.random() * 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    const halo = this.add.circle(x, y, 38, 0xff9900, 0.07);
    this.tweens.add({
      targets: halo,
      alpha: { from: 0.04, to: 0.11 },
      duration: 1400 + Math.random() * 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: 200,
    });
    // Glow circle behind flame
    const glow = this.add.circle(x, y + 4, 14, 0xff6600, 0.12);

    // Torch handle
    this.add.rectangle(x, y + 12, 4, 16, 0x5c3d1e);

    // Flame (layered rectangles)
    const flame1 = this.add.rectangle(x,     y - 2,  6, 14, 0xff8800, 0.9);
    const flame2 = this.add.rectangle(x,     y - 6,  4,  8, 0xffcc00, 0.85);
    const spark  = this.add.rectangle(x,     y - 10, 2,  4, 0xffffff, 0.7);

    // Animate flicker
    [flame1, flame2, spark, glow].forEach((obj, i) => {
      const tween = this.tweens.add({
        targets:  obj,
        alpha:    { from: obj.alpha * 0.6, to: obj.alpha },
        scaleY:   { from: 0.85, to: 1.15 },
        y:        obj.y + (i < 3 ? -2 : 0),
        duration: 220 + i * 40 + Math.random() * 80,
        yoyo:     true,
        repeat:   -1,
        ease:     'Sine.easeInOut',
        delay:    i * 60,
      });
      this.torchTweens.push(tween);
    });
  }

  // ── LPC animations ─────────────────────────────────────────────────────
  _registerAnimations() {
    // Generated user sheets register their own animation keys after lazy-load.
  }

  _registerBodyAnimations(textureKey, animPrefix, cols, sheetConfig = null) {
    if (!this.textures.exists(textureKey)) return;
    const F = makeF(cols);
    Object.entries(ANIM_ROW_DEFS).forEach(([name, def]) => {
      const animKey = `${animPrefix}_${name}`;
      if (!this.anims.exists(animKey)) {
        const frames = name === 'idle' && sheetConfig?.idleFrame
          ? [F(sheetConfig.idleFrame.row, sheetConfig.idleFrame.col)]
          : def.rowFn(F);
        this.anims.create({
          key:       animKey,
          frames:    this.anims.generateFrameNumbers(textureKey, { frames }),
          frameRate: def.rate,
          repeat:    def.loop,
        });
      }
    });
  }

  _registerWeaponAnimations() {
    // Per-class weapon animations — accounts for different column counts and row layouts per sheet
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      const key = `${cls}_weapon`;
      if (!this.textures.exists(key)) return;
      const Fw   = makeF(WEAPON_SHEET_COLS[cls] ?? 18);
      const rows = WEAPON_ANIM_ROWS[cls];
      const holdFrame = rows.hold ? Fw(rows.hold.row, rows.hold.col) : Fw(rows.idle, rows.idleCol ?? 0);
      const attackFrames = rows.attackCols
        ? rows.attackCols.map((col) => Fw(rows.attack, col))
        : Array.from({ length: rows.attackFrames }, (_, i) => Fw(rows.attack, i));
      const defs = {
        idle:   { frames: [holdFrame],                                                       rate: 1,  loop: -1 },
        walk:   { frames: rows.staticHold ? [holdFrame] : Array.from({ length: rows.walkFrames }, (_, i) => Fw(rows.walk, (rows.walkStartCol ?? 0) + i)), rate: 9, loop: -1 },
        attack: { frames: rows.staticHold ? [holdFrame] : attackFrames,                       rate: 10, loop: 0  },
        hurt:   { frames: rows.staticHold ? [holdFrame] : [Fw(rows.hurt, 0), Fw(rows.hurt, 1), Fw(rows.hurt, 2)], rate: 8,  loop: 0  },
        dead:   { frames: rows.staticHold ? [holdFrame] : Array.from({ length: 6 }, (_, i) => Fw(rows.dead, i)), rate: 6,  loop: 0  },
        jump:   { frames: [holdFrame],                                                       rate: 1,  loop: -1 },
      };
      Object.entries(defs).forEach(([name, def]) => {
        const animKey = `${cls}_weapon_${name}`;
        if (!this.anims.exists(animKey)) {
          this.anims.create({
            key:       animKey,
            frames:    this.anims.generateFrameNumbers(key, { frames: def.frames }),
            frameRate: def.rate,
            repeat:    def.loop,
          });
        }
      });
    });
  }

  // ── Overlays (countdown / result / vs) ─────────────────────────────────
  _buildOverlays() {
    this.overlayBg = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65)
      .setVisible(false).setDepth(10);
    this.overlayText = this.add.text(W / 2, H / 2, '', {
      fontSize: '72px', fontFamily: 'monospace',
      color: '#c9a84c', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5).setVisible(false).setDepth(11);
    this.overlaySubText = this.add.text(W / 2, H / 2 + 70, '', {
      fontSize: '20px', fontFamily: 'monospace', color: '#f8fafc', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false).setDepth(11);
    this.vsText = this.add.text(W / 2, 200, 'VS', {
      fontSize: '48px', fontFamily: 'monospace', color: '#ffffff', fontStyle: 'bold',
      stroke: '#c9a84c', strokeThickness: 4,
    }).setOrigin(0.5).setAlpha(0).setVisible(false).setDepth(11);
  }

  // ── Top HUD (permanent HP bars) ────────────────────────────────────────
  _buildTopHud() {
    // Dark strip background (stored so setHudVisible can toggle it)
    this._hudBg = this.add.rectangle(W / 2, 19, W, 36, 0x000000, 0.72).setDepth(20);

    // ── Player 1 (left, "YOU") ──────────────────────────────────────────
    const p1Name = this.add.text(16, 9, 'YOU', {
      fontSize: '10px', fontFamily: 'monospace', fontStyle: 'bold', color: '#facc15',
    }).setOrigin(0, 0.5).setDepth(21);

    const p1HpBg = this.add.rectangle(16, 26, 160, 12, 0x1a1a1a)
      .setOrigin(0, 0.5).setDepth(21);

    const p1HpChip = this.add.rectangle(16, 26, 160, 12, 0xf97316, 0.85)
      .setOrigin(0, 0.5).setDepth(21.5);

    const p1HpBar = this.add.rectangle(16, 26, 160, 12, 0x22c55e)
      .setOrigin(0, 0.5).setDepth(22);

    const p1HpText = this.add.text(182, 26, '100', {
      fontSize: '9px', fontFamily: 'monospace', color: '#f8fafc',
    }).setOrigin(1, 0.5).setDepth(21);

    // ── Player 2 (right, opponent) ──────────────────────────────────────
    const p2Name = this.add.text(W - 16, 9, 'OPP', {
      fontSize: '10px', fontFamily: 'monospace', fontStyle: 'bold', color: '#94a3b8',
    }).setOrigin(1, 0.5).setDepth(21);

    const p2HpBg = this.add.rectangle(W - 16, 26, 160, 12, 0x1a1a1a)
      .setOrigin(1, 0.5).setDepth(21);

    const p2HpChip = this.add.rectangle(W - 16, 26, 160, 12, 0xf97316, 0.85)
      .setOrigin(1, 0.5).setDepth(21.5);

    const p2HpBar = this.add.rectangle(W - 16, 26, 160, 12, 0x22c55e)
      .setOrigin(1, 0.5).setDepth(22);

    const p2HpText = this.add.text(W - 182, 26, '100', {
      fontSize: '9px', fontFamily: 'monospace', color: '#f8fafc',
    }).setOrigin(0, 0.5).setDepth(21);

    // Center timer
    const timerText = this.add.text(W / 2, 19, '0:00', {
      fontSize: '11px', fontFamily: 'monospace', fontStyle: 'bold', color: '#c9a84c',
    }).setOrigin(0.5).setDepth(21);

    // Class badge bars — thin colored bars on left/right edges, colored when player joins
    const p1ClassBar = this.add.rectangle(3, 19, 6, 34, 0x444444, 0.3).setOrigin(0, 0.5).setDepth(22);
    const p2ClassBar = this.add.rectangle(W - 3, 19, 6, 34, 0x444444, 0.3).setOrigin(1, 0.5).setDepth(22);

    this.hud = {
      p1Name, p1HpBg, p1HpChip, p1HpBar, p1HpText,
      p2Name, p2HpBg, p2HpChip, p2HpBar, p2HpText,
      p1MaxHp: 100, p2MaxHp: 100,
      p1LastHp: null, p2LastHp: null,
      p1PulseTween: null, p2PulseTween: null,
      timerText, p1ClassBar, p2ClassBar,
      battleStartMs: 0,
    };
    this.setHudVisible(false);

  }

  // Show or hide the entire top HUD strip (HP bars + names)
  setHudVisible(visible) {
    if (!this.hud) return;
    const keys = [
      'p1Name', 'p1HpBg', 'p1HpChip', 'p1HpBar', 'p1HpText',
      'p2Name', 'p2HpBg', 'p2HpChip', 'p2HpBar', 'p2HpText',
      'timerText', 'p1ClassBar', 'p2ClassBar',
    ];
    keys.forEach((k) => {
      if (this.hud[k]?.active) this.hud[k].setVisible(visible);
    });
    // Also hide the dark background strip — it is the first rectangle added in _buildTopHud
    // We store a ref to it so we can toggle it too
    if (this._hudBg?.active) this._hudBg.setVisible(visible);
  }

  _updateHudSlot(slot, hp, maxHp) {
    const pct = Math.max(0, hp / maxHp);
    const bar = this.hud[slot + 'HpBar'];
    const chip = this.hud[slot + 'HpChip'];
    const previousHp = this.hud[slot + 'LastHp'];
    const nextWidth = 160 * pct;

    if (typeof previousHp === 'number' && hp < previousHp && chip?.active) {
      chip.width = 160 * Math.max(0, previousHp / maxHp);
      chip.setAlpha(0.9);
      this.tweens.killTweensOf(chip);
      this.tweens.add({
        targets: chip,
        width: nextWidth,
        alpha: 0.35,
        delay: 110,
        duration: 420,
        ease: 'Cubic.easeOut',
      });
    } else if (chip?.active) {
      chip.width = nextWidth;
      chip.setAlpha(0.35);
    }
    this.hud[slot + 'LastHp'] = hp;

    bar.width = nextWidth;
    bar.setFillStyle(pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444);

    this.hud[slot + 'HpText'].setText(String(Math.ceil(hp)));

    // Pulsation when critically low
    if (pct <= 0.25 && !this.hud[slot + 'PulseTween']) {
      this.hud[slot + 'PulseTween'] = this.tweens.add({
        targets: bar,
        alpha: { from: 1, to: 0.3 },
        yoyo: true, repeat: -1, duration: 300,
      });
    } else if (pct > 0.25 && this.hud[slot + 'PulseTween']) {
      this.hud[slot + 'PulseTween'].stop();
      bar.setAlpha(1);
      this.hud[slot + 'PulseTween'] = null;
    }
  }

  // ── 3. Wire Colyseus room ───────────────────────────────────────────────
  _setupWeaponDebug() {
    const enabled = new URLSearchParams(window.location.search).get('weaponDebug') === '1';
    if (!enabled || !this.input?.keyboard) return;

    this.weaponDebug = {
      enabled: true,
      state: 'idle',
      poses: {},
      bodyAuto: false,
      lastBodyTick: 0,
      text: this.add.text(10, 46, '', {
        fontSize: '10px',
        fontFamily: 'monospace',
        color: '#facc15',
        backgroundColor: 'rgba(0,0,0,0.75)',
        padding: { x: 6, y: 5 },
      }).setDepth(30).setScrollFactor(0),
    };

    this.input.keyboard.on('keydown', (event) => {
      if (!this.weaponDebug?.enabled) return;
      const handled = this._handleWeaponDebugKey(event);
      if (handled) event.preventDefault();
    });

    console.info('[weaponDebug] enabled. Arrows move, [] col, ;/quote row, -/= scale, ,/. rotate, N/M body frame, T auto body, Z/X state, R reset, P print config.');
    this._refreshWeaponDebugText();
  }

  _handleWeaponDebugKey(event) {
    const active = this._getWeaponDebugTarget();
    const key = event.key;
    const stateIdx = WEAPON_DEBUG_STATES.indexOf(this.weaponDebug.state);

    if (key === 'z' || key === 'Z') {
      this.weaponDebug.state = WEAPON_DEBUG_STATES[(stateIdx - 1 + WEAPON_DEBUG_STATES.length) % WEAPON_DEBUG_STATES.length];
      this._applyWeaponDebugToActive();
      return true;
    }
    if (key === 'x' || key === 'X') {
      this.weaponDebug.state = WEAPON_DEBUG_STATES[(stateIdx + 1) % WEAPON_DEBUG_STATES.length];
      this._applyWeaponDebugToActive();
      return true;
    }
    if (key === 'p' || key === 'P') {
      this._printWeaponDebugConfig();
      return true;
    }
    if (key === 't' || key === 'T') {
      this.weaponDebug.bodyAuto = !this.weaponDebug.bodyAuto;
      this.weaponDebug.lastBodyTick = 0;
      this._applyWeaponDebugToActive();
      return true;
    }

    if (!active) {
      this._refreshWeaponDebugText('No active weapon sprite');
      return false;
    }

    const { s } = active;
    const pose = this._getWeaponDebugPose(s.cls, this.weaponDebug.state);
    const step = event.shiftKey ? 5 : 1;
    const scaleStep = event.shiftKey ? 0.05 : 0.01;
    const rotationStep = event.shiftKey ? 15 : 3;
    const maxBodyFrame = this._getWeaponDebugBodyFrames(s.cls, this.weaponDebug.state).length - 1;
    const maxRow = this._getWeaponMaxRow(s.cls);
    const maxCol = (WEAPON_SHEET_COLS[s.cls] ?? 18) - 1;

    if (key === 'ArrowLeft') pose.xOff -= step;
    else if (key === 'ArrowRight') pose.xOff += step;
    else if (key === 'ArrowUp') pose.yOff -= step;
    else if (key === 'ArrowDown') pose.yOff += step;
    else if (key === '[') pose.col = Math.max(0, pose.col - 1);
    else if (key === ']') pose.col = Math.min(maxCol, pose.col + 1);
    else if (key === ';') pose.row = Math.max(0, pose.row - 1);
    else if (key === "'" || key === '"') pose.row = Math.min(maxRow, pose.row + 1);
    else if (key === '-' || key === '_') pose.scale = Math.max(0.2, Number((pose.scale - scaleStep).toFixed(2)));
    else if (key === '=' || key === '+') pose.scale = Math.min(2, Number((pose.scale + scaleStep).toFixed(2)));
    else if (key === ',' || key === '<') pose.rotation = Number((pose.rotation - rotationStep).toFixed(1));
    else if (key === '.' || key === '>') pose.rotation = Number((pose.rotation + rotationStep).toFixed(1));
    else if (key === '0') pose.rotation = 0;
    else if (key === 'n' || key === 'N') pose.bodyFrame = Math.max(0, (pose.bodyFrame || 0) - 1);
    else if (key === 'm' || key === 'M') pose.bodyFrame = Math.min(maxBodyFrame, (pose.bodyFrame || 0) + 1);
    else if (key === 'r' || key === 'R') this._resetWeaponDebugPose(s.cls, this.weaponDebug.state);
    else return false;

    this._applyWeaponDebug(active.sessionId, active.player);
    return true;
  }

  _getWeaponDebugTarget() {
    if (!this.weaponDebug?.enabled || !this.room?.state?.players) return null;
    const preferred = this.mySessionId && this.sprites.get(this.mySessionId);
    const preferredPlayer = this.mySessionId && this.room.state.players.get(this.mySessionId);
    if (preferred?.weapon?.active && preferredPlayer) {
      return { sessionId: this.mySessionId, s: preferred, player: preferredPlayer };
    }

    for (const [sessionId, s] of this.sprites.entries()) {
      const player = this.room.state.players.get(sessionId);
      if (s.weapon?.active && player) return { sessionId, s, player };
    }
    return null;
  }

  _getWeaponMaxRow(cls) {
    const texture = this.textures.get(`${cls}_weapon`);
    const frameCount = Math.max(0, (texture?.frameTotal ?? 1) - 1);
    return Math.max(0, Math.floor(frameCount / (WEAPON_SHEET_COLS[cls] ?? 18)));
  }

  _getDefaultWeaponDebugPose(cls, state) {
    const rows = WEAPON_ANIM_ROWS[cls] ?? WEAPON_ANIM_ROWS.warrior;
    const anchor = WEAPON_ANCHOR[cls] ?? { xOff: 0, yOff: 0 };
    let row = rows.idle ?? 0;
    let col = rows.idleCol ?? 0;

    if (rows.hold && rows.staticHold) {
      row = rows.hold.row;
      col = rows.hold.col;
    } else if (state === 'walk') {
      row = rows.walk ?? row;
      col = 0;
    } else if (state === 'attack') {
      row = rows.attack ?? row;
      col = rows.attackCols?.[0] ?? 0;
    } else if (state === 'hurt') {
      row = rows.hurt ?? row;
      col = 0;
    } else if (state === 'dead') {
      row = rows.dead ?? row;
      col = 0;
    }

    const basePose = {
      row,
      col,
      xOff: anchor.xOff,
      yOff: anchor.yOff,
      scale: WEAPON_VISUAL_SCALE[cls] ?? 1,
      rotation: 0,
      bodyFrame: 0,
    };
    const preset = WEAPON_POSE_PRESETS[cls]?.[state] ?? WEAPON_POSE_PRESETS[cls]?.default;
    return preset ? { ...basePose, ...preset } : basePose;
  }

  _getWeaponDebugPose(cls, state) {
    const key = `${cls}:${state}`;
    if (!this.weaponDebug.poses[key]) {
      this.weaponDebug.poses[key] = this._getDefaultWeaponDebugPose(cls, state);
    }
    return this.weaponDebug.poses[key];
  }

  _resetWeaponDebugPose(cls, state) {
    this.weaponDebug.poses[`${cls}:${state}`] = this._getDefaultWeaponDebugPose(cls, state);
  }

  _applyWeaponDebugToActive() {
    const active = this._getWeaponDebugTarget();
    if (!active) {
      this._refreshWeaponDebugText('No active weapon sprite');
      return;
    }
    this._applyWeaponDebug(active.sessionId, active.player);
  }

  _tickWeaponDebug(time) {
    const active = this._getWeaponDebugTarget();
    if (!active) {
      if (time - (this.weaponDebug.lastBodyTick || 0) > 500) {
        this.weaponDebug.lastBodyTick = time;
        this._refreshWeaponDebugText('No active weapon sprite');
      }
      return;
    }

    if (!this.weaponDebug.bodyAuto) return;
    if (time - this.weaponDebug.lastBodyTick <= 140) return;

    const pose = this._getWeaponDebugPose(active.s.cls, this.weaponDebug.state);
    const frames = this._getWeaponDebugBodyFrames(active.s.cls, this.weaponDebug.state);
    pose.bodyFrame = ((pose.bodyFrame || 0) + 1) % Math.max(1, frames.length);
    this.weaponDebug.lastBodyTick = time;
    this._applyWeaponDebug(active.sessionId, active.player);
  }

  _applyWeaponDebug(sessionId, player) {
    const s = this.sprites.get(sessionId);
    if (!this.weaponDebug?.enabled || !s?.weapon?.active || !player) return;

    const pose = this._getWeaponDebugPose(s.cls, this.weaponDebug.state);
    const frame = makeF(WEAPON_SHEET_COLS[s.cls] ?? 18)(pose.row, pose.col);
    const phase = this.room?.state?.phase;
    const isWaiting = !phase || phase === 'waiting' || phase === 'connecting';
    const x = isWaiting ? W / 2 : player.x;
    const visualY = player.y + FOOT_OFFSET;
    const xMul = player.facingRight ? 1 : -1;
    const ySquash = s.cls === 'rogue' ? 0.86 : 1;

    s.weapon.stop?.();
    s.weapon.setFrame?.(frame);
    s.weapon.setPosition(x + xMul * pose.xOff, visualY + pose.yOff);
    s.weapon.setScale(SPRITE_SCALE * pose.scale, SPRITE_SCALE * ySquash * pose.scale);
    s.weapon.setRotation(Phaser.Math.DegToRad((pose.rotation || 0) * xMul));
    s.weapon.setFlipX(!player.facingRight);
    s.weapon.setVisible(Boolean(player.hasWeapon));

    this._applyWeaponDebugBodyPose(s, this.weaponDebug.state);
    this._refreshWeaponDebugText();
  }

  _applyWeaponDebugBodyPose(s, state) {
    if (!s?.body?.active || !s.useLPC) return;
    const pose = this._getWeaponDebugPose(s.cls, state);
    const frames = this._getWeaponDebugBodyFrames(s.cls, state);
    s.body.stop();
    s.body.setFrame(frames[Math.min(pose.bodyFrame || 0, frames.length - 1)]);
  }

  _getWeaponDebugBodyFrames(cls, state) {
    const normalizedState = state === 'attack' ? 'attack' : state;
    const def = ANIM_ROW_DEFS[normalizedState] ?? ANIM_ROW_DEFS.idle;
    const F = makeF(CLASS_COLS[cls] ?? 13);
    return def.rowFn(F);
  }

  _refreshWeaponDebugText(extra = '') {
    if (!this.weaponDebug?.text?.active) return;
    const active = this._getWeaponDebugTarget();
    if (!active) {
      this.weaponDebug.text.setText(`weaponDebug=1\n${extra || 'Waiting for weapon sprite'}`);
      return;
    }

    const pose = this._getWeaponDebugPose(active.s.cls, this.weaponDebug.state);
    this.weaponDebug.text.setText([
      'weaponDebug=1',
      `class=${active.s.cls} state=${this.weaponDebug.state} auto=${this.weaponDebug.bodyAuto ? 'on' : 'off'}`,
      `row=${pose.row} col=${pose.col} xOff=${pose.xOff} yOff=${pose.yOff} scale=${pose.scale} rot=${pose.rotation || 0}`,
      `bodyFrame=${pose.bodyFrame || 0}`,
      'arrows move | [] col | ;/quote row | -/= scale',
      ',/. rotate | N/M body frame | T auto body | 0 reset rot',
      'Z/X state | R reset | P print config',
      extra,
    ].filter(Boolean).join('\n'));
  }

  _printWeaponDebugConfig() {
    const active = this._getWeaponDebugTarget();
    if (!active) return;
    const cls = active.s.cls;
    const config = {};
    WEAPON_DEBUG_STATES.forEach((state) => {
      config[state] = this._getWeaponDebugPose(cls, state);
    });
    console.info(`[weaponDebug] ${cls} config`, config);
    console.info(JSON.stringify({ [cls]: config }, null, 2));
    this._refreshWeaponDebugText('Printed config to console');
  }

  _createHeldWeapon(cls, x, visualY, player) {
    const key = `${cls}_held_weapon`;
    if (!this.textures.exists(key)) return null;
    const pose = HELD_WEAPON_POSE[cls] ?? HELD_WEAPON_POSE.warrior;
    const facingRight = this._getVisualFacingRight(player);
    const xMul = facingRight ? 1 : -1;
    const weapon = this.add.image(x + xMul * pose.xOff, visualY + pose.yOff, key);
    weapon.setOrigin(0.5, 0.5);
    weapon.setScale(pose.scale);
    weapon.setRotation(Phaser.Math.DegToRad((pose.rotation || 0) * xMul));
    weapon.setFlipX(!facingRight);
    weapon.setDepth(2.8);
    return weapon;
  }

  _syncHeldWeapon(s, player, x, visualY) {
    if (!s.weapon?.active) return;
    const pose = HELD_WEAPON_POSE[s.cls] ?? HELD_WEAPON_POSE.warrior;
    const facingRight = this._getVisualFacingRight(player);
    const xMul = facingRight ? 1 : -1;
    s.weapon.setVisible(player.state !== 'disconnected' && Boolean(player.hasWeapon));
    s.weapon.setFlipX(!facingRight);
    if (!s.weaponSwingTween) {
      s.weapon.setPosition(x + xMul * pose.xOff, visualY + pose.yOff);
      s.weapon.setScale(pose.scale);
      s.weapon.setRotation(Phaser.Math.DegToRad((pose.rotation || 0) * xMul));
    }
  }

  _swingHeldWeapon(s, player) {
    if (!s.weapon?.active) return;
    if (s.weaponSwingTween) s.weaponSwingTween.stop();
    const pose = HELD_WEAPON_POSE[s.cls] ?? HELD_WEAPON_POSE.warrior;
    const xMul = player.facingRight ? 1 : -1;
    const startX = player.x + xMul * pose.xOff;
    const startY = player.y + FOOT_OFFSET + pose.yOff;
    const base = (pose.rotation || 0) * xMul;
    s.weapon.setPosition(startX - xMul * 6, startY + 4);
    s.weapon.setScale(pose.scale * 1.06);
    s.weapon.setRotation(Phaser.Math.DegToRad(base - 65 * xMul));
    s.weaponSwingTween = this.tweens.add({
      targets: s.weapon,
      x: startX + xMul * 24,
      y: startY - 8,
      scale: pose.scale * 1.18,
      rotation: Phaser.Math.DegToRad(base + 78 * xMul),
      duration: 135,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        s.weaponSwingTween = null;
        if (s.weapon?.active) {
          s.weapon.setPosition(startX, startY);
          s.weapon.setScale(pose.scale);
          s.weapon.setRotation(Phaser.Math.DegToRad(base));
        }
      },
    });
  }

  _playAttackBodyMotion(s, player) {
    if (!s.body?.active || player.state === 'dead' || player.state === 'hurt') return;
    const attackKey = `${s.animPrefix || s.cls}_attack`;
    if (!this.anims.exists(attackKey)) return;

    s.body.play(attackKey, false);
    s.body.once('animationcomplete', (anim) => {
      if (anim?.key !== attackKey || !s.body?.active) return;
      const currentState = player.state;
      if (currentState === 'dead' || currentState === 'hurt' || currentState === 'attacking') return;
      const nextKey = `${s.animPrefix || s.cls}_${STATE_ANIM[currentState] ?? 'idle'}`;
      if (this.anims.exists(nextKey)) s.body.play(nextKey, true);
    });
  }

  playWeaponSwing(sessionId = this.mySessionId) {
    const s = this.sprites.get(sessionId);
    const player = this.room?.state?.players?.get(sessionId);
    if (!s || !player) return;
    this._playAttackBodyMotion(s, player);
  }

  _getVisualFacingRight(player) {
    const phase = this.room?.state?.phase;
    const isWaiting = !phase || phase === 'waiting' || phase === 'connecting';
    return isWaiting ? true : player.facingRight;
  }

  _getDynamicBodySheetDescriptor(player) {
    const cls = String(player.characterClass || 'warrior').toLowerCase();
    const path = String(player.battleSpritesheetPath || '');
    const hash = String(player.battleSpritesheetHash || '');
    if (!path || !hash || !path.startsWith('/generated/')) return null;
    const safeHash = hash.replace(/[^A-Za-z0-9_-]/g, '_');
    return {
      key: `dynamic_body_${safeHash}`,
      animPrefix: `dynamic_body_${safeHash}`,
      path,
      url: resolveRuntimeAssetUrl(path),
      generated: true,
      cols: 13,
      frameWidth: 128,
      frameHeight: 128,
      originY: 0.75,
      cls,
    };
  }

  _ensureDynamicBodySheetLoaded(player) {
    const desc = this._getDynamicBodySheetDescriptor(player);
    if (!desc || this.textures.exists(desc.key) || this.dynamicSheetLoads.has(desc.key)) return;

    this.dynamicSheetLoads.add(desc.key);
    this.load.setCORS('anonymous');
    this.load.spritesheet(desc.key, desc.url, {
      frameWidth: desc.frameWidth,
      frameHeight: desc.frameHeight,
    });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.dynamicSheetLoads.delete(desc.key);
      if (!this.textures.exists(desc.key)) return;
      this._registerBodyAnimations(desc.key, desc.animPrefix, desc.cols, desc);
      this.room?.state?.players?.forEach((p, sessionId) => {
        if (String(p.battleSpritesheetHash || '').replace(/[^A-Za-z0-9_-]/g, '_') !== desc.key.replace('dynamic_body_', '')) return;
        const sprite = this.sprites.get(sessionId);
        if (sprite) {
          this._applyGeneratedBodyIfAvailable(sprite, p);
          this.syncPlayer(sessionId, p);
        }
      });
    });
    if (!this.load.isLoading()) this.load.start();
  }

  _getBodySheetDescriptor(player) {
    const cls = String(player.characterClass || 'warrior').toLowerCase();
    const dynamic = this._getDynamicBodySheetDescriptor(player);
    if (dynamic) {
      if (this.textures.exists(dynamic.key)) return dynamic;
      this._ensureDynamicBodySheetLoaded(player);
    }
    return {
      key: `missing_body_${cls}`,
      animPrefix: cls,
      generated: false,
      originY: 1,
    };
  }

  _applyGeneratedBodyIfAvailable(s, player) {
    if (!s?.body?.active) return false;
    const desc = this._getBodySheetDescriptor(player);
    if (!this.textures.exists(desc.key)) return false;
    if (s.bodyTextureKey === desc.key) return desc.generated;

    if (!s.useLPC) {
      const x = s.body.x;
      const y = s.body.y;
      const oldBody = s.body;
      s.body = this.add.sprite(x, y, desc.key);
      s.body.setDepth(2);
      oldBody.destroy();
      s.useLPC = true;
    } else {
      s.body.setTexture(desc.key);
    }
    s.bodyTextureKey = desc.key;
    s.animPrefix = desc.animPrefix;
    s.usesGeneratedSheet = desc.generated;
    s.body.setOrigin(0.5, desc.originY);
    s.body.setScale(SPRITE_SCALE);
    if (s.cls === 'rogue') s.body.setScale(SPRITE_SCALE, SPRITE_SCALE * 0.86);

    const stateKey = `${s.animPrefix}_${STATE_ANIM[player.state] ?? 'idle'}`;
    if (this.anims.exists(stateKey)) s.body.play(stateKey, true);

    if (desc.generated && s.weapon?.active) {
      s.weapon.setVisible(false);
    }
    return desc.generated;
  }

  setRoom(room, mySessionId) {
    if (!this.sceneReady) {
      // Preload hasn't finished yet — defer until create() completes
      this._pendingRoom    = room;
      this._pendingSession = mySessionId;
      return;
    }
    this._wireRoom(room, mySessionId);
  }

  _wireRoom(room, mySessionId) {
    if (this.room === room && this.mySessionId === mySessionId) return;
    if (this.room && this.room !== room) {
      Array.from(this.sprites.keys()).forEach((sessionId) => this.removePlayerSprite(sessionId));
    }
    this.room = room;
    this.mySessionId = mySessionId;

    room.state.players.onAdd((player, sessionId) => {
      if (this.room !== room) return;
      if (this.sprites.has(sessionId)) this.removePlayerSprite(sessionId);
      this.createPlayerSprite(sessionId, player);
      player.onChange(() => {
        if (this.room === room) this.syncPlayer(sessionId, player);
      });
    });
    room.state.players.onRemove((_p, sessionId) => {
      if (this.room === room) this.removePlayerSprite(sessionId);
    });
    room.state.onChange(() => {
      if (this.room === room) this.handlePhaseChange(room.state);
    });
    room.onMessage('damage_number', (d) => {
      if (this.room === room) {
        this.showDamageNumber(d.x, d.y, d.damage, {
          blocked: Boolean(d.blocked),
          attackerSid: d.attackerSid,
          targetSid: d.targetSid,
        });
      }
    });
    room.onMessage('ability_used',  (d) => {
      if (this.room === room) this.showAbilityEffect(d);
    });
    room.onMessage('weapon_swing',  (d) => {
      if (this.room === room) this.playWeaponSwing(d.sessionId);
    });
  }

  // ── 4. Create player visuals ────────────────────────────────────────────
  createPlayerSprite(sessionId, player) {
    const isMe   = sessionId === this.mySessionId;
    const cls    = player.characterClass || 'warrior';
    const bodyDesc = this._getBodySheetDescriptor(player);
    const key    = bodyDesc.key;
    const useLPC = this.textures.exists(key);
    const waitingForGeneratedSheet = Boolean(this._getDynamicBodySheetDescriptor(player)) && !useLPC;

    // During waiting/connecting, display all sprites at center regardless of server x position
    const phase = this.room?.state?.phase;
    const isWaiting = !phase || phase === 'waiting' || phase === 'connecting';
    const spawnX = isWaiting ? W / 2 : player.x;

    const visualY = player.y + FOOT_OFFSET;
    const topY  = visualY - (useLPC ? SPRITE_HEIGHT : 72);
    const hpY   = topY - 10;
    const nameY = topY - 22;
    const meY   = topY - 36;

    // Floor shadow (ellipse under feet)
    const shadow = this.add.ellipse(spawnX, visualY + 2, 64, 14, 0x000000, 0.45);
    shadow.setDepth(1);

    // Class aura — colored glow circle behind sprite (depth 1, behind body at depth 2)
    const aura = this.add.circle(spawnX, visualY - SPRITE_HEIGHT / 2, 34, CLASS_COLORS[cls] ?? 0xe74c3c, 0.20);
    aura.setDepth(1);

    let body;
    let weapon = null;
    if (useLPC) {
      const facingRight = this._getVisualFacingRight(player);
      body = this.add.sprite(spawnX, visualY, key);
      body.setOrigin(0.5, bodyDesc.originY || 1).setScale(SPRITE_SCALE).setFlipX(!facingRight);
      body.play(`${bodyDesc.animPrefix}_idle`);
      if (cls === 'rogue') body.setScale(SPRITE_SCALE, SPRITE_SCALE * 0.86);
      body.setDepth(2);

      // Equipped weapons are baked into generated LPC sheets.
    } else {
      body = this.add.rectangle(
        spawnX,
        visualY,
        42,
        72,
        CLASS_COLORS[cls] ?? 0xe74c3c,
        waitingForGeneratedSheet ? 0 : 0.9
      );
      body.setOrigin(0.5, 1);
      if (!waitingForGeneratedSheet) body.setStrokeStyle(2, isMe ? 0xffffff : 0x888888);
      body.setDepth(2);
    }

    const nameLabel = this.add.text(spawnX, nameY, player.username, {
      fontSize: '11px', fontFamily: 'monospace',
      color: isMe ? '#facc15' : '#f8fafc', fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(3);

    const classLabel = this.add.text(spawnX, nameY + 11, cls.toUpperCase(), {
      fontSize: '9px', fontFamily: 'monospace', color: CLASS_HEX[cls] ?? '#e74c3c',
    }).setOrigin(0.5, 1).setDepth(3);

    const hpBg   = this.add.rectangle(spawnX, hpY, 56, 7, 0x1a1a1a).setStrokeStyle(1, 0x444444).setDepth(3);
    const hpChip = this.add.rectangle(spawnX - 28, hpY, 56, 7, 0xf97316, 0.85).setOrigin(0, 0.5).setDepth(3.1);
    const hpBar  = this.add.rectangle(spawnX - 28, hpY, 56, 7, 0x22c55e).setOrigin(0, 0.5).setDepth(3.2);

    const meTag = isMe
      ? this.add.text(spawnX, meY, '▼ YOU', {
          fontSize: '9px', fontFamily: 'monospace', color: '#facc15', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(3)
      : null;

    // Enchant glow effect
    const enchant = player.weaponEnchant || 0;
    const xMulE = this._getVisualFacingRight(player) ? 1 : -1;
    const trailX = spawnX + xMulE * 16;
    const trailY = visualY - (cls === 'rogue' ? 45 : 52);
    const enchantTrail = applyEnchantFX(this, weapon, enchant, trailX, trailY, cls);

    this.sprites.set(sessionId, {
      body, shadow, aura, weapon, useLPC, cls,
      bodyTextureKey: key,
      animPrefix: bodyDesc.animPrefix,
      usesGeneratedSheet: bodyDesc.generated,
      nameLabel, classLabel, hpBg, hpChip, hpBar, meTag, dcLabel: null, stunLabel: null,
      blockFx: null,
      blockFxTween: null,
      maxHp: player.maxHp || 100,
      lastHp: player.hp,
      deathPlayed: false,
      hpPulseTween: null,
      lastState: '',
      wasJumping: false,
      enchantTrail,
      lastWeaponEnchant: enchant,
    });

    if (this.weaponDebug?.enabled) this._applyWeaponDebug(sessionId, player);

    if (this.hud) {
      const slot = sessionId === this.mySessionId ? 'p1' : 'p2';
      this.hud[slot + 'Name'].setText(player.username);
      this.hud[slot + 'MaxHp'] = player.maxHp || 100;
      this._updateHudSlot(slot, player.hp, player.maxHp || 100);
      this.hud[slot + 'ClassBar'].setFillStyle(CLASS_COLORS[cls] ?? 0x888888).setAlpha(1);
    }
  }

  // ── 5. Sync player state ────────────────────────────────────────────────
  syncPlayer(sessionId, player) {
    const s = this.sprites.get(sessionId);
    if (!s) return;

    if (this.hud) {
      const slot = sessionId === this.mySessionId ? 'p1' : 'p2';
      this._updateHudSlot(slot, player.hp, this.hud[slot + 'MaxHp']);
    }

    // During waiting/connecting keep sprite pinned to center; don't follow server position
    const phase = this.room?.state?.phase;
    const isWaiting = !phase || phase === 'waiting' || phase === 'connecting';
    const x = isWaiting ? W / 2 : player.x;
    const visualY = player.y + FOOT_OFFSET;

    s.body.setPosition(x, visualY);
    if (s.useLPC) s.body.setFlipX(!this._getVisualFacingRight(player));
    const usesGeneratedSheet = this._applyGeneratedBodyIfAvailable(s, player);
    if (s.aura?.active) s.aura.setPosition(x, visualY - SPRITE_HEIGHT / 2);
    if (s.weapon?.active) {
      if (usesGeneratedSheet) {
        s.weapon.setVisible(false);
      } else {
        this._syncHeldWeapon(s, player, x, visualY);
      }
      if (s.enchantTrail?.active) {
        s.enchantTrail.setVisible(!usesGeneratedSheet && player.state !== 'disconnected' && Boolean(player.hasWeapon));
      }
    }

    // Re-apply enchant glow when weaponEnchant changes (async loadout arrives after spawn)
    const newEnchant = player.weaponEnchant || 0;
    if (newEnchant !== s.lastWeaponEnchant) {
      if (s.enchantTrail) { s.enchantTrail.destroy(); s.enchantTrail = null; }
      const xMulT = this._getVisualFacingRight(player) ? 1 : -1;
      const tX = x + xMulT * 16;
      const tY = visualY - (s.cls === 'rogue' ? 45 : 52);
      s.enchantTrail = applyEnchantFX(this, s.weapon, newEnchant, tX, tY, s.cls);
      s.lastWeaponEnchant = newEnchant;
    }

    if (s.enchantTrail && s.weapon) {
      // Trail must follow where weapon PIXELS actually render, not the raw sprite origin.
      // The anchor shifts the sprite so idle frame pixel (60,3) lands on the hand.
      // Derive hand screen coords from that invariant: hand = sprite_pos + (60−32,3−64)*scale.
      const xMul   = this._getVisualFacingRight(player) ? 1 : -1;
      const tX = x  + xMul * 16;                        // (60−32)*2 − anchor.xOff = 16
      const tY = visualY + (s.cls === 'rogue' ? -45 : -52); // 3−64 * scaleY + anchor.yOff
      s.enchantTrail.setPosition(tX, tY);
    }

    // Floor shadow — shrinks and fades more dramatically when airborne
    const shadowScale = Math.max(0.12, 1 - (FLOOR_Y - player.y) / 140);
    s.shadow.setPosition(x, FLOOR_Y + FOOT_OFFSET + 2);
    s.shadow.setScale(shadowScale, shadowScale);
    s.shadow.setAlpha(0.55 * shadowScale);

    const topY  = visualY - (s.useLPC ? SPRITE_HEIGHT : 72);
    const hpY   = topY - 10;
    const nameY = topY - 22;
    const meY   = topY - 36;

    s.nameLabel.setPosition(x, nameY);
    s.classLabel.setPosition(x, nameY + 11);
    s.hpBg.setPosition(x, hpY);
    s.hpChip.setPosition(x - 28, hpY);
    s.hpBar.setPosition(x - 28, hpY);
    if (s.meTag) s.meTag.setPosition(x, meY);
    this._syncBlockGuard(s, player, x, visualY, topY);

    // HP bar
    const pct = Math.max(0, player.hp / s.maxHp);
    const hpWidth = 56 * pct;
    if (typeof s.lastHp === 'number' && player.hp < s.lastHp) {
      s.hpChip.width = 56 * Math.max(0, s.lastHp / s.maxHp);
      s.hpChip.setAlpha(0.85);
      this.tweens.killTweensOf(s.hpChip);
      this.tweens.add({
        targets: s.hpChip,
        width: hpWidth,
        alpha: 0.25,
        delay: 100,
        duration: 360,
        ease: 'Cubic.easeOut',
      });
    } else {
      s.hpChip.width = hpWidth;
      s.hpChip.setAlpha(0.25);
    }
    s.lastHp = player.hp;
    s.hpBar.width = hpWidth;
    s.hpBar.setFillStyle(pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444);

    // Pulsation on in-world HP bar when critically low
    if (pct <= 0.25 && !s.hpPulseTween) {
      s.hpPulseTween = this.tweens.add({
        targets: s.hpBar, alpha: { from: 1, to: 0.25 },
        yoyo: true, repeat: -1, duration: 280, ease: 'Sine.easeInOut',
      });
    } else if (pct > 0.25 && s.hpPulseTween) {
      s.hpPulseTween.stop();
      s.hpBar.setAlpha(1);
      s.hpPulseTween = null;
    }

    // Stun indicator ★★★
    if (player.isStunned && !s.stunLabel) {
      s.stunLabel = this.add.text(x, topY - 12, '★★★', {
        fontSize: '13px', color: '#ffff00', fontFamily: 'monospace', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(4);
      this.tweens.add({ targets: s.stunLabel, alpha: { from: 1, to: 0.3 }, yoyo: true, repeat: -1, duration: 300 });
    } else if (!player.isStunned && s.stunLabel) {
      this.tweens.killTweensOf(s.stunLabel);
      s.stunLabel.destroy();
      s.stunLabel = null;
    }
    if (s.stunLabel) s.stunLabel.setPosition(x, topY - 12);

    // ── Animations ───────────────────────────────────────────────────────
    if (s.useLPC) {
      const st = player.state;

      // Hit flash on state transition to 'hurt'
      if (st === 'hurt' && s.lastState !== 'hurt' && s.body.active) {
        s.body.setTint(0xffffff);
        this.time.delayedCall(80, () => {
          const sc = this.sprites.get(sessionId);
          if (sc?.body?.active) sc.body.clearTint();
        });
      }

      // Landing dust burst — triggers when jumping state ends
      if (s.wasJumping && st !== 'jumping' && this.dustEmitter?.active) {
        this.dustEmitter.explode(10, x - 14, FLOOR_Y + FOOT_OFFSET + 2);
        this.dustEmitter.explode(10, x + 14, FLOOR_Y + FOOT_OFFSET + 2);
      }
      s.wasJumping = (st === 'jumping');

      // Attack whoosh — once per attack state entry
      if (st === 'attacking' && s.lastState !== 'attacking') {
        const wY = visualY - SPRITE_HEIGHT * 0.55;
        _spawnWhoosh(this, x, wY, player.facingRight);
      }

      s.lastState = st;

      if (st === 'disconnected') {
        s.body.setAlpha(0.3);
        if (s.weapon?.active) s.weapon.setAlpha(0.3);
        this._ensureDcLabel(s, x, topY - 12);
        return;
      }
      if (s.body.alpha < 1 && st !== 'dead') {
        s.body.setAlpha(1);
        if (s.weapon?.active) s.weapon.setAlpha(1);
      }
      if (s.dcLabel) s.dcLabel.setVisible(false);

      if (st === 'dead') {
        if (!s.deathPlayed) {
          s.deathPlayed = true;

          // Death slow-motion — 300ms at 0.3x speed, then snap back
          // setTimeout is intentional: immune to Phaser timeScale, always fires in real time
          this.time.timeScale = 0.3;
          this.tweens.timeScale = 0.3;
          setTimeout(() => {
            if (this.time && this.tweens && this.scene?.isActive('BattleScene')) {
              this.time.timeScale = 1;
              this.tweens.timeScale = 1;
            }
          }, 300);

          const dk = `${s.animPrefix || s.cls}_dead`;
          if (this.anims.exists(dk)) {
            s.body.play(dk, false);
            s.body.once('animationcomplete', () => s.body.setAlpha(0.4));
          } else {
            s.body.setAlpha(0.35);
          }
          if (s.weapon?.active) {
            const wk = `${s.cls}_weapon_dead`;
            s.weapon.setVisible(Boolean(player.hasWeapon));
            if (this.anims.exists(wk)) {
              s.weapon.play?.(wk, false);
              s.weapon.once('animationcomplete', () => {
                if (s.weapon?.active) s.weapon.setAlpha(0.4);
              });
            } else {
              s.weapon.setAlpha(0.35);
            }
          }
        }
        return;
      }

      const animKey = `${s.animPrefix || s.cls}_${STATE_ANIM[st] ?? 'idle'}`;
      if (this.anims.exists(animKey)) s.body.play(animKey, true);

      if (s.weapon?.active) {
        const weaponAnimKey = `${s.cls}_weapon_${STATE_ANIM[st] ?? 'idle'}`;
        if (this.anims.exists(weaponAnimKey)) s.weapon.play?.(weaponAnimKey, true);
      }

      if (this.weaponDebug?.enabled) this._applyWeaponDebug(sessionId, player);

    } else {
      const st = player.state;
      if (st === 'disconnected') {
        s.body.setAlpha(0.3);
        this._ensureDcLabel(s, x, topY - 12);
      } else {
        if (s.dcLabel) s.dcLabel.setVisible(false);
        if (st !== 'dead') s.body.setAlpha(1);
      }
      if (st === 'hurt') {
        s.body.setFillStyle(0xffffff);
        this.time.delayedCall(80, () => {
          const sc = this.sprites.get(sessionId);
          if (sc) sc.body.setFillStyle(CLASS_COLORS[sc.cls] ?? 0xe74c3c, 0.9);
        });
      }
      if (st === 'attacking') {
        s.body.setScale(1.15, 0.88);
        this.time.delayedCall(180, () => {
          const sc = this.sprites.get(sessionId);
          if (sc) sc.body.setScale(1, 1);
        });
      }
      if (st === 'dead' && !s.deathPlayed) {
        s.deathPlayed = true;
        s.body.setAlpha(0.35);
        s.body.setAngle(90);
      }
    }
  }

  _ensureDcLabel(s, x, y) {
    if (!s.dcLabel) {
      s.dcLabel = this.add.text(x, y, '📡 DC', {
        fontSize: '10px', fontFamily: 'monospace', color: '#f59e0b', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(4);
    }
    s.dcLabel.setPosition(x, y).setVisible(true);
  }

  _isBlocking(player) {
    return Boolean(player?.isBlocking) || player?.state === 'blocking';
  }

  _syncBlockGuard(s, player, x, visualY, topY) {
    const visible = this._isBlocking(player) && player.state !== 'dead' && player.state !== 'disconnected';
    if (!visible) {
      if (s.blockFx?.active) s.blockFx.setVisible(false);
      return;
    }

    if (!s.blockFx?.active) {
      s.blockFx = this.add.graphics().setDepth(4);
      s.blockFxTween = this.tweens.add({
        targets: s.blockFx,
        alpha: { from: 0.62, to: 1 },
        yoyo: true,
        repeat: -1,
        duration: 520,
        ease: 'Sine.easeInOut',
      });
    }

    const facingRight = this._getVisualFacingRight(player);
    const xMul = facingRight ? 1 : -1;
    const shieldX = x + xMul * 31;
    const shieldY = Math.max(topY + 46, visualY - 62);
    s.blockShieldX = shieldX;
    s.blockShieldY = shieldY;
    const g = s.blockFx;

    g.clear();
    g.setVisible(true);
    g.fillStyle(0x60a5fa, 0.14);
    g.lineStyle(3, 0xbfdbfe, 0.9);
    g.beginPath();
    g.moveTo(shieldX, shieldY - 38);
    g.lineTo(shieldX + xMul * 24, shieldY - 23);
    g.lineTo(shieldX + xMul * 18, shieldY + 16);
    g.lineTo(shieldX, shieldY + 34);
    g.lineTo(shieldX - xMul * 18, shieldY + 16);
    g.lineTo(shieldX - xMul * 24, shieldY - 23);
    g.closePath();
    g.fillPath();
    g.strokePath();

    g.lineStyle(1, 0xe0f2fe, 0.6);
    g.beginPath();
    g.moveTo(shieldX, shieldY - 25);
    g.lineTo(shieldX + xMul * 12, shieldY - 13);
    g.lineTo(shieldX + xMul * 9, shieldY + 9);
    g.lineTo(shieldX, shieldY + 20);
    g.lineTo(shieldX - xMul * 9, shieldY + 9);
    g.lineTo(shieldX - xMul * 12, shieldY - 13);
    g.closePath();
    g.strokePath();
  }

  // ── 6. Remove player ───────────────────────────────────────────────────
  removePlayerSprite(sessionId) {
    const s = this.sprites.get(sessionId);
    if (!s) return;
    if (s.stunLabel) this.tweens.killTweensOf(s.stunLabel);
    if (s.hpPulseTween) this.tweens.killTweensOf(s.hpBar);
    if (s.blockFxTween) this.tweens.killTweensOf(s.blockFx);
    if (s.enchantTrail) { s.enchantTrail.destroy(); }
    [s.body, s.weapon, s.shadow, s.aura, s.nameLabel, s.classLabel, s.hpBg, s.hpChip, s.hpBar, s.meTag, s.dcLabel, s.stunLabel, s.blockFx]
      .forEach((o) => o?.destroy());
    this.sprites.delete(sessionId);
  }

  // ── 7. Phase transitions ────────────────────────────────────────────────
  handlePhaseChange(state) {
    const phase = state.phase;

    if (phase !== this.lastPhase) {
      this.lastPhase = phase;

      // Show HUD only during active combat phases
      this.setHudVisible(phase === 'battle' || phase === 'countdown');

      if (phase === 'countdown') {
        this._showVsScreen(state);
        // Move sprites to their actual server positions when battle is about to start
        this.sprites.forEach((s, sessionId) => {
          const p = state.players?.get(sessionId);
          if (p) {
            const visualY = p.y + FOOT_OFFSET;
            s.body.setPosition(p.x, visualY);
            this._syncHeldWeapon(s, p, p.x, visualY);
            if (s.aura?.active) s.aura.setPosition(p.x, visualY - SPRITE_HEIGHT / 2);
            s.shadow.setPosition(p.x, FLOOR_Y + FOOT_OFFSET + 2);
          }
        });
      }
      if (phase === 'battle') {
        this._clearVsObjects();
        this.hideOverlay();
        this.vsText.setVisible(false);
        this.showBattleGo();
        if (this.hud) this.hud.battleStartMs = this.time.now;
      }
      if (phase === 'finished') {
        this._showFinishSequence(state);
      }
    }

    // Animated countdown number on each tick
    if (phase === 'countdown' && state.countdown !== this._lastCountdown && state.countdown > 0) {
      this._lastCountdown = state.countdown;
      this._animateCountdownNumber(state.countdown);
    }
  }

  // VS screen shown at start of countdown
  _showVsScreen(state) {
    this.overlayBg.setVisible(true);
    this.overlaySubText.setText('Get ready!').setVisible(true);

    const players = [...state.players.values()];
    const p1 = players[0];
    const p2 = players[1];

    if (p1 && p2) {
      const nameStyle = {
        fontSize: '20px', fontFamily: 'monospace', fontStyle: 'bold',
        color: '#f8fafc', stroke: '#000000', strokeThickness: 5,
      };
      const n1 = this.add.text(W / 2 - 110, H / 2 - 14, p1.username, nameStyle)
        .setOrigin(1, 0.5).setDepth(12).setAlpha(0);
      const vs = this.add.text(W / 2, H / 2 - 10, 'VS', {
        fontSize: '44px', fontFamily: 'monospace', fontStyle: 'bold',
        color: '#c9a84c', stroke: '#000000', strokeThickness: 6,
      }).setOrigin(0.5).setDepth(12).setAlpha(0);
      const n2 = this.add.text(W / 2 + 110, H / 2 - 14, p2.username, nameStyle)
        .setOrigin(0, 0.5).setDepth(12).setAlpha(0);

      const cls1 = (p1.characterClass || 'warrior').toUpperCase();
      const cls2 = (p2.characterClass || 'warrior').toUpperCase();
      const c1 = this.add.text(W / 2 - 110, H / 2 + 8, cls1, {
        fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold',
        color: CLASS_HEX[p1.characterClass] ?? '#e74c3c',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(1, 0).setDepth(12).setAlpha(0);
      const c2 = this.add.text(W / 2 + 110, H / 2 + 8, cls2, {
        fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold',
        color: CLASS_HEX[p2.characterClass] ?? '#e74c3c',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0, 0).setDepth(12).setAlpha(0);

      this.tweens.add({ targets: [n1, vs, n2, c1, c2], alpha: 1, duration: 400, ease: 'Power2' });
      this._vsObjects = [n1, vs, n2, c1, c2];
    }
  }

  _clearVsObjects() {
    this._vsObjects.forEach((o) => { if (o?.active) o.destroy(); });
    this._vsObjects = [];
  }

  // Animated bounce-in per countdown number
  _animateCountdownNumber(num) {
    // Hide "Get ready!" subtitle once numbers start
    if (this.overlaySubText?.visible) this.overlaySubText.setVisible(false);
    this._clearVsObjects();

    const COLOR = { 3: '#22c55e', 2: '#f59e0b', 1: '#ef4444' };
    const color = COLOR[num] ?? '#c9a84c';

    const txt = this.add.text(W / 2, H / 2, String(num), {
      fontSize: '140px', fontFamily: 'monospace', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: 14,
    }).setOrigin(0.5).setDepth(13).setScale(3).setAlpha(0);

    // Bounce in
    this.tweens.add({
      targets: txt, scaleX: 1, scaleY: 1, alpha: 1,
      duration: 220, ease: 'Back.easeOut',
      onComplete: () => {
        // Hold then shrink out
        this.tweens.add({
          targets: txt, scaleX: 0.5, scaleY: 0.5, alpha: 0,
          duration: 300, ease: 'Power2', delay: 380,
          onComplete: () => { if (txt.active) txt.destroy(); },
        });
      },
    });

    // Flash tint matching number color
    const flashColor = num === 1 ? 0xff2200 : num === 2 ? 0xf59e0b : 0x22c55e;
    const flash = this.add.rectangle(W / 2, H / 2, W, H, flashColor, 0.08).setDepth(7);
    this.tweens.add({ targets: flash, alpha: 0, duration: 250, onComplete: () => { if (flash.active) flash.destroy(); } });

    this.cameras.main.shake(50, 0.003);
  }

  // Dramatic zoom-in on loser, then show result overlay
  _showFinishSequence(state) {
    const loser  = state.players.get(state.loserId);
    const winner = state.players.get(state.winnerId);
    const isWinner = state.winnerId === this.mySessionId;

    if (loser) {
      this.cameras.main.zoomTo(1.9, 700, 'Power2');
      this.cameras.main.pan(loser.x, loser.y - 40, 700, 'Power2');
    }

    // Show result after zoom settles
    this.time.delayedCall(950, () => {
      if (!this.scene?.isActive()) return;
      // Pull camera back
      this.cameras.main.zoomTo(1, 500, 'Sine.easeInOut');
      this.cameras.main.pan(W / 2, H / 2, 500, 'Sine.easeInOut');

      this.showOverlay(
        isWinner ? 'VICTORY!' : 'DEFEAT',
        winner ? `${winner.username} wins` : '',
        isWinner ? '#facc15' : '#ef4444',
      );
    });
  }

  showOverlay(title, sub = '', color = '#c9a84c') {
    this.overlayBg.setVisible(true);
    this.overlayText.setText(title).setColor(color).setVisible(true);
    this.overlaySubText.setText(sub).setVisible(true);
    this._playSound(title.startsWith('VICTORY') ? 'victory' : 'defeat');
  }

  hideOverlay() {
    this.overlayBg.setVisible(false);
    this.overlayText.setVisible(false);
    this.overlaySubText.setVisible(false);
  }

  showBattleGo() {
    // Green flash
    const flash = this.add.rectangle(W / 2, H / 2, W, H, 0x00ff44, 0.15).setDepth(11);
    this.tweens.add({ targets: flash, alpha: 0, duration: 350, onComplete: () => { if (flash.active) flash.destroy(); } });

    const go = this.add.text(W / 2, H / 2, 'FIGHT!', {
      fontSize: '80px', fontFamily: 'monospace', color: '#22c55e', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 10,
    }).setOrigin(0.5).setDepth(12).setScale(0.4).setAlpha(0);

    // Pop in then burst out
    this.tweens.add({
      targets: go, scaleX: 1.1, scaleY: 1.1, alpha: 1,
      duration: 180, ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: go, scaleX: 1.8, scaleY: 1.8, alpha: 0,
          duration: 500, ease: 'Power2', delay: 250,
          onComplete: () => { if (go.active) go.destroy(); },
        });
      },
    });

    this.cameras.main.shake(220, 0.012);

    this.spectators.forEach(({ obj, baseY }, i) => {
      if (!obj.active) return;
      this.tweens.add({
        targets: obj,
        y: baseY - 7,
        duration: 90,
        ease: 'Power2',
        delay: (obj.x / W) * 320 + Math.random() * 60,
        yoyo: true,
        onComplete: () => { if (obj.active) obj.setY(baseY); },
      });
    });
  }

  // ── 8. Damage number + particles + screen shake ─────────────────────────
  showDamageNumber(gameX, gameY, damage, opts = {}) {
    const blocked = Boolean(opts.blocked);
    this._playSound(blocked ? 'block' : 'hit');

    if (blocked) {
      const targetSprite = opts.targetSid ? this.sprites.get(opts.targetSid) : null;
      const impactX = targetSprite?.blockShieldX ?? gameX;
      const impactY = targetSprite?.blockShieldY ?? gameY;
      this._showBlockImpact(impactX, impactY);
      this._pulseBlockGuard(targetSprite, impactX, impactY);
      const text = damage > 0 ? `-${damage} BLOCK` : 'BLOCK';
      const txt = this.add.text(impactX, impactY, text, {
        fontSize: '20px', fontFamily: 'monospace',
        color: '#93c5fd', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(6);

      this.tweens.add({
        targets: txt,
        y: impactY - 58,
        alpha: 0,
        scaleX: 1.18,
        scaleY: 1.18,
        duration: 760,
        ease: 'Power1',
        onComplete: () => { if (txt.active) txt.destroy(); },
      });
      this.cameras.main.shake(90, 0.003);
      return;
    }

    // Particle burst
    if (this.hitEmitter) {
      const count = this._isMobile ? (damage >= 20 ? 5 : 3) : (damage >= 20 ? 14 : 8);
      this.hitEmitter.explode(count, gameX, gameY);
    }

    // Screen shake on heavy hits
    if (damage >= 20) {
      this.cameras.main.shake(160, 0.006);
    }

    // Floating number
    const isBig  = damage >= 20;
    const color  = isBig ? '#ff2200' : '#ef4444';
    const size   = isBig ? '28px'    : '20px';
    const txt = this.add.text(gameX, gameY, `-${damage}`, {
      fontSize: size, fontFamily: 'monospace',
      color, fontStyle: 'bold',
      stroke: '#000', strokeThickness: isBig ? 5 : 3,
    }).setOrigin(0.5).setDepth(5);

    this.tweens.add({
      targets: txt,
      y:       gameY - 65,
      alpha:   0,
      scaleX:  isBig ? 1.4 : 1,
      scaleY:  isBig ? 1.4 : 1,
      duration: 850,
      ease: 'Power1',
      onComplete: () => txt.destroy(),
    });
  }

  _pulseBlockGuard(targetSprite, gameX, gameY) {
    if (targetSprite?.blockFx?.active) {
      targetSprite.blockFx.setVisible(true);
      targetSprite.blockFx.setAlpha(1);
    }

    const flare = this.add.graphics().setDepth(7);
    flare.lineStyle(4, 0xe0f2fe, 0.9);
    flare.strokeCircle(gameX, gameY, 27);
    flare.lineStyle(2, 0x60a5fa, 0.75);
    flare.strokeCircle(gameX, gameY, 39);
    this.tweens.add({
      targets: flare,
      alpha: 0,
      scaleX: 1.24,
      scaleY: 1.24,
      duration: 220,
      ease: 'Power2',
      onComplete: () => { if (flare.active) flare.destroy(); },
    });
  }

  _showBlockImpact(gameX, gameY) {
    const ring = this.add.graphics().setDepth(6);
    ring.lineStyle(3, 0xbfdbfe, 0.95);
    ring.strokeCircle(gameX, gameY, 18);
    ring.lineStyle(2, 0x60a5fa, 0.75);
    ring.beginPath();
    ring.moveTo(gameX - 18, gameY - 12);
    ring.lineTo(gameX + 18, gameY + 12);
    ring.moveTo(gameX + 18, gameY - 12);
    ring.lineTo(gameX - 18, gameY + 12);
    ring.strokePath();
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scaleX: 2.2,
      scaleY: 2.2,
      duration: 260,
      ease: 'Power2',
      onComplete: () => { if (ring.active) ring.destroy(); },
    });

    const flash = this.add.rectangle(gameX, gameY, 52, 70, 0x60a5fa, 0.16).setDepth(5);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.45,
      scaleY: 1.15,
      duration: 180,
      ease: 'Power2',
      onComplete: () => { if (flash.active) flash.destroy(); },
    });
  }

  // ── 9. Ability visual effects ─────────────────────────────────────────────
  showAbilityEffect(d) {
    this._playSound('ability');
    const abilityKey = String(d.abilityKey || d.ability_key || '');
    if (abilityKey === 'warrior_guardbreak') {
      this._showGuardBreakEffect(d.fromX, d.fromY, d.toX, d.toY, d.hit);
      return;
    }
    if (d.cls === 'warrior') this._showBashEffect(d.fromX, d.fromY, d.hit, abilityKey);
    if (d.cls === 'mage')    this._showFireballEffect(d.fromX, d.fromY, d.toX, d.toY, d.hit, abilityKey);
    if (d.cls === 'rogue')   this._showBlinkEffect(d.fromX, d.fromY, d.toX, abilityKey);
  }

  _showCombatText(x, y, label, color = '#f8fafc', size = '16px') {
    const txt = this.add.text(x, y, label, {
      fontSize: size,
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color,
      stroke: '#020617',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(14);
    this.tweens.add({
      targets: txt,
      y: y - 34,
      alpha: 0,
      scaleX: 1.14,
      scaleY: 1.14,
      duration: 620,
      ease: 'Power1',
      onComplete: () => { if (txt.active) txt.destroy(); },
    });
  }

  _showGuardBreakEffect(fromX, fromY, toX, toY, hit) {
    showGuardBreak(this, { fromX, fromY, toX, toY, hit });
  }

  _showBashEffect(x, y, hit, abilityKey = '') {
    showBash(this, { x, y, hit, abilityKey });
  }

  _showFireballEffect(fromX, fromY, toX, toY, hit, abilityKey = '') {
    showFireball(this, { fromX, fromY, toX, toY, hit, abilityKey });
  }

  _showBlinkEffect(fromX, fromY, toX, abilityKey = '') {
    showBlink(this, { fromX, fromY, toX, abilityKey });
  }

  update(time) {
    if (!this.room) return;

    // Timer update
    if (this.hud?.battleStartMs > 0 && this.hud?.timerText?.active) {
      const elapsed = Math.floor((time - this.hud.battleStartMs) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      this.hud.timerText.setText(`${m}:${String(s).padStart(2, '0')}`);
    }

    // Mage levitation
    this.sprites.forEach((s, sessionId) => {
      if (s.cls !== 'mage' || !s.useLPC || s.deathPlayed) return;
      const p = this.room.state?.players?.get(sessionId);
      if (!p || p.state !== 'idle') return;
      const floatY = Math.sin(time * 0.0025) * 5;
      const vy = p.y + FOOT_OFFSET + floatY;
      s.body.setY(vy);
      this._syncHeldWeapon(s, p, p.x, vy);
      if (s.aura?.active) s.aura.setY(vy - SPRITE_HEIGHT / 2);
    });

    if (this.weaponDebug?.enabled) this._tickWeaponDebug(time);
  }

  _playSound(type) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this._audioCtx) this._audioCtx = new AudioCtx();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;

      if (type === 'hit') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);

      } else if (type === 'block') {
        [520, 740].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.025);
          osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.14 + i * 0.025);
          gain.gain.setValueAtTime(0.16, now + i * 0.025);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16 + i * 0.025);
          osc.start(now + i * 0.025); osc.stop(now + 0.18 + i * 0.025);
        });

      } else if (type === 'ability') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.28);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.start(now); osc.stop(now + 0.32);

      } else if (type === 'victory') {
        [262, 330, 392, 523].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now + i * 0.13);
          gain.gain.linearRampToValueAtTime(0.3, now + i * 0.13 + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.13 + 0.35);
          osc.start(now + i * 0.13); osc.stop(now + i * 0.13 + 0.38);
        });

      } else if (type === 'defeat') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.55);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.start(now); osc.stop(now + 0.6);
      }
    } catch (_) {}
  }
}
