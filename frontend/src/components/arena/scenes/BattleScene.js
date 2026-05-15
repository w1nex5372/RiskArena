import Phaser from 'phaser';

const W = 800;
const H = 420;
const FLOOR_Y = 360;

// Per-class column counts (warrior/mage = 13, rogue = 18 from generator output)
const CLASS_COLS = { warrior: 13, mage: 13, rogue: 18 };

// Build frame-index helper for a given column count
const makeF = (cols) => (row, col) => row * cols + col;

// Animation row definitions — same rows work for all LPC sheets
const ANIM_ROW_DEFS = {
  idle:   { rowFn: (F) => [F(10, 0)],                                    rate: 1,  loop: -1 },
  walk:   { rowFn: (F) => Array.from({ length: 9 }, (_, i) => F(10, i)), rate: 9,  loop: -1 },
  attack: { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(15, i)), rate: 12, loop: 0  },
  hurt:   { rowFn: (F) => [F(20, 0), F(20, 1), F(20, 2)],               rate: 8,  loop: 0  },
  dead:   { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(20, i)), rate: 6,  loop: 0  },
  jump:   { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(4, i)),  rate: 10, loop: 0  },
};

const STATE_ANIM = {
  idle:      'idle',
  walking:   'walk',
  attacking: 'attack',
  hurt:      'hurt',
  dead:      'dead',
  jumping:   'jump',
};

const SPRITE_SCALE   = 2.0;
const SPRITE_HEIGHT  = 64 * SPRITE_SCALE;
// LPC art leaves ~6px empty at frame bottom; at 2x scale push sprite down 12px to land on floor
const FOOT_OFFSET    = 12;

const CLASS_COLORS = { warrior: 0xe74c3c, mage: 0x9b59b6, rogue: 0x2ecc71 };
const CLASS_HEX    = { warrior: '#e74c3c', mage: '#9b59b6', rogue: '#2ecc71' };
const WEAPON_COLS  = 18; // weapon sheets: 1152px / 64px = 18 cols
const CLASS_WEAPON = { warrior: 'warrior_katana', mage: 'mage_staff', rogue: 'rogue_scimitar' };

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
    this.torchTweens     = [];
    this.sceneReady      = false;
    this._pendingRoom    = null;
    this._pendingSession = null;
    this._lastCountdown  = -1;
    this._vsObjects      = [];
    this.spectators      = [];
    this.hud             = null;
  }

  // ── 1. Preload ─────────────────────────────────────────────────────────
  preload() {
    this.load.on('loaderror', (file) => {
      console.warn(`[BattleScene] ${file.key} missing — using rectangle fallback`);
    });
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      this.load.spritesheet(`${cls}_sheet`, `/characters/${cls}_sheet.png`, {
        frameWidth: 64, frameHeight: 64,
      });
    });
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      this.load.spritesheet(`${cls}_weapon`, `/items/${CLASS_WEAPON[cls]}.png`, {
        frameWidth: 64, frameHeight: 64,
      });
    });
  }

  // ── 2. Create scene ────────────────────────────────────────────────────
  create() {
    this._createParticleTexture();
    this._buildArena();
    this._buildFloorFog();
    this._registerAnimations();
    this._registerWeaponAnimations();
    this._buildOverlays();
    this._buildTopHud();

    // Mark ready — textures guaranteed loaded by this point
    this.sceneReady = true;
    if (this._pendingRoom) {
      this._wireRoom(this._pendingRoom, this._pendingSession);
      this._pendingRoom = null;
      this._pendingSession = null;
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
    for (let i = 0; i < 90; i++) {
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
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      const key = `${cls}_sheet`;
      if (!this.textures.exists(key)) return;
      const cols = CLASS_COLS[cls] ?? 13;
      const F    = makeF(cols);
      Object.entries(ANIM_ROW_DEFS).forEach(([name, def]) => {
        const animKey = `${cls}_${name}`;
        if (!this.anims.exists(animKey)) {
          this.anims.create({
            key:       animKey,
            frames:    this.anims.generateFrameNumbers(key, { frames: def.rowFn(F) }),
            frameRate: def.rate,
            repeat:    def.loop,
          });
        }
      });
    });
  }

  _registerWeaponAnimations() {
    const Fw = makeF(WEAPON_COLS);
    // Weapon overlay PNGs only have content in rows 60-69 (bottom of the sheet).
    // Row layout (LPC order: N/W/S/E per animation type):
    //   60-63 = Walk (East = row 63), 64-67 = Slash (East = row 67), 68 = Hurt, 69 = Death
    const defs = {
      idle:   { frames: [Fw(63, 0)],                                     rate: 1,  loop: -1 },
      walk:   { frames: Array.from({ length: 9 }, (_, i) => Fw(63, i)),  rate: 9,  loop: -1 },
      attack: { frames: Array.from({ length: 6 }, (_, i) => Fw(67, i)),  rate: 12, loop: 0  },
      hurt:   { frames: [Fw(68, 0), Fw(68, 1), Fw(68, 2)],              rate: 8,  loop: 0  },
      dead:   { frames: Array.from({ length: 6 }, (_, i) => Fw(69, i)),  rate: 6,  loop: 0  },
      jump:   { frames: [Fw(63, 0)],                                     rate: 1,  loop: -1 },
    };
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      const key = `${cls}_weapon`;
      if (!this.textures.exists(key)) return;
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
      p1Name, p1HpBg, p1HpBar, p1HpText,
      p2Name, p2HpBg, p2HpBar, p2HpText,
      p1MaxHp: 100, p2MaxHp: 100,
      p1PulseTween: null, p2PulseTween: null,
      timerText, p1ClassBar, p2ClassBar,
      battleStartMs: 0,
    };

  }

  // Show or hide the entire top HUD strip (HP bars + names)
  setHudVisible(visible) {
    if (!this.hud) return;
    const keys = ['p1Name', 'p1HpBg', 'p1HpBar', 'p1HpText', 'p2Name', 'p2HpBg', 'p2HpBar', 'p2HpText'];
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

    bar.width = 160 * pct;
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
    this.room = room;
    this.mySessionId = mySessionId;

    room.state.players.onAdd((player, sessionId) => {
      this.createPlayerSprite(sessionId, player);
      player.onChange(() => this.syncPlayer(sessionId, player));
    });
    room.state.players.onRemove((_p, sessionId) => this.removePlayerSprite(sessionId));
    room.state.onChange(() => this.handlePhaseChange(room.state));
    room.onMessage('damage_number', (d) => this.showDamageNumber(d.x, d.y, d.damage));
    room.onMessage('ability_used',  (d) => this.showAbilityEffect(d));
  }

  // ── 4. Create player visuals ────────────────────────────────────────────
  createPlayerSprite(sessionId, player) {
    const isMe   = sessionId === this.mySessionId;
    const cls    = player.characterClass || 'warrior';
    const key    = `${cls}_sheet`;
    const useLPC = this.textures.exists(key);

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
    const shadow = this.add.ellipse(spawnX, visualY + 2, 52, 12, 0x000000, 0.35);
    shadow.setDepth(1);

    // Class aura — colored glow circle behind sprite (depth 1, behind body at depth 2)
    const aura = this.add.circle(spawnX, visualY - SPRITE_HEIGHT / 2, 34, CLASS_COLORS[cls] ?? 0xe74c3c, 0.20);
    aura.setDepth(1);

    let body;
    let weapon = null;
    if (useLPC) {
      body = this.add.sprite(spawnX, visualY, key);
      body.setOrigin(0.5, 1).setScale(SPRITE_SCALE).setFlipX(!player.facingRight);
      body.play(`${cls}_idle`);
      if (cls === 'rogue') body.setScale(SPRITE_SCALE, SPRITE_SCALE * 0.86);
      body.setDepth(2);

      // Weapon overlay — only shown if player has a weapon item equipped in their loadout
      const weaponKey = `${cls}_weapon`;
      if (this.textures.exists(weaponKey) && player.hasWeapon) {
        const wScale = cls === 'rogue' ? [SPRITE_SCALE, SPRITE_SCALE * 0.86] : [SPRITE_SCALE, SPRITE_SCALE];
        weapon = this.add.sprite(spawnX, visualY, weaponKey);
        weapon.setOrigin(0.5, 1).setScale(wScale[0], wScale[1]).setFlipX(!player.facingRight);
        weapon.play(`${cls}_weapon_idle`);
        weapon.setDepth(2);
      }
    } else {
      body = this.add.rectangle(spawnX, visualY, 42, 72, CLASS_COLORS[cls] ?? 0xe74c3c, 0.9);
      body.setOrigin(0.5, 1);
      body.setStrokeStyle(2, isMe ? 0xffffff : 0x888888);
      body.setDepth(2);
    }

    const nameLabel = this.add.text(spawnX, nameY, player.username, {
      fontSize: '11px', fontFamily: 'monospace',
      color: isMe ? '#facc15' : '#f8fafc', fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(3);

    const classLabel = this.add.text(spawnX, nameY + 11, cls.toUpperCase(), {
      fontSize: '9px', fontFamily: 'monospace', color: CLASS_HEX[cls] ?? '#e74c3c',
    }).setOrigin(0.5, 1).setDepth(3);

    const hpBg  = this.add.rectangle(spawnX, hpY, 56, 7, 0x1a1a1a).setStrokeStyle(1, 0x444444).setDepth(3);
    const hpBar = this.add.rectangle(spawnX - 28, hpY, 56, 7, 0x22c55e).setOrigin(0, 0.5).setDepth(3);

    const meTag = isMe
      ? this.add.text(spawnX, meY, '▼ YOU', {
          fontSize: '9px', fontFamily: 'monospace', color: '#facc15', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(3)
      : null;

    this.sprites.set(sessionId, {
      body, shadow, aura, weapon, useLPC, cls,
      nameLabel, classLabel, hpBg, hpBar, meTag, dcLabel: null, stunLabel: null,
      maxHp: player.maxHp || 100,
      deathPlayed: false,
      hpPulseTween: null,
      lastState: '',
    });

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
    if (s.useLPC) s.body.setFlipX(!player.facingRight);
    if (s.aura?.active) s.aura.setPosition(x, visualY - SPRITE_HEIGHT / 2);
    // Lazy-create weapon overlay if loadout fetch completed after initial spawn
    if (s.useLPC && player.hasWeapon && !s.weapon) {
      const weaponKey = `${s.cls}_weapon`;
      if (this.textures.exists(weaponKey)) {
        const wScale = s.cls === 'rogue' ? [SPRITE_SCALE, SPRITE_SCALE * 0.86] : [SPRITE_SCALE, SPRITE_SCALE];
        s.weapon = this.add.sprite(x, visualY, weaponKey);
        s.weapon.setOrigin(0.5, 1).setScale(wScale[0], wScale[1]).setFlipX(!player.facingRight);
        s.weapon.play(`${s.cls}_weapon_idle`);
        s.weapon.setDepth(2);
      }
    }

    if (s.weapon?.active) {
      // Hide weapon when dead/disconnected; otherwise follow hasWeapon flag
      const alive = player.state !== 'dead' && player.state !== 'disconnected' && !s.deathPlayed;
      s.weapon.setVisible(alive && Boolean(player.hasWeapon));
      s.weapon.setPosition(x, visualY);
      s.weapon.setFlipX(!player.facingRight);
    }

    // Floor shadow follows feet, shrinks when jumping
    const shadowScale = Math.max(0.3, 1 - (FLOOR_Y - player.y) / 200);
    s.shadow.setPosition(x, FLOOR_Y + FOOT_OFFSET + 2);
    s.shadow.setScale(shadowScale, shadowScale);
    s.shadow.setAlpha(0.35 * shadowScale);

    const topY  = visualY - (s.useLPC ? SPRITE_HEIGHT : 72);
    const hpY   = topY - 10;
    const nameY = topY - 22;
    const meY   = topY - 36;

    s.nameLabel.setPosition(x, nameY);
    s.classLabel.setPosition(x, nameY + 11);
    s.hpBg.setPosition(x, hpY);
    s.hpBar.setPosition(x - 28, hpY);
    if (s.meTag) s.meTag.setPosition(x, meY);

    // HP bar
    const pct = Math.max(0, player.hp / s.maxHp);
    s.hpBar.width = 56 * pct;
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
          const dk = `${s.cls}_dead`;
          if (this.anims.exists(dk)) {
            s.body.play(dk, false);
            s.body.once('animationcomplete', () => s.body.setAlpha(0.4));
          } else {
            s.body.setAlpha(0.35);
          }
          if (s.weapon?.active) s.weapon.setVisible(false);
        }
        return;
      }

      const animKey = `${s.cls}_${STATE_ANIM[st] ?? 'idle'}`;
      if (this.anims.exists(animKey)) s.body.play(animKey, true);

      if (s.weapon?.active) {
        const weaponAnimKey = `${s.cls}_weapon_${STATE_ANIM[st] ?? 'idle'}`;
        if (this.anims.exists(weaponAnimKey)) s.weapon.play(weaponAnimKey, true);
      }

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

  // ── 6. Remove player ───────────────────────────────────────────────────
  removePlayerSprite(sessionId) {
    const s = this.sprites.get(sessionId);
    if (!s) return;
    if (s.stunLabel) this.tweens.killTweensOf(s.stunLabel);
    if (s.hpPulseTween) this.tweens.killTweensOf(s.hpBar);
    [s.body, s.weapon, s.shadow, s.aura, s.nameLabel, s.classLabel, s.hpBg, s.hpBar, s.meTag, s.dcLabel, s.stunLabel]
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
  showDamageNumber(gameX, gameY, damage) {
    this._playSound('hit');
    // Particle burst
    if (this.hitEmitter) {
      this.hitEmitter.explode(damage >= 20 ? 14 : 8, gameX, gameY);
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

  // ── 9. Ability visual effects ─────────────────────────────────────────────
  showAbilityEffect(d) {
    this._playSound('ability');
    if (d.cls === 'warrior') this._showBashEffect(d.fromX, d.fromY, d.hit);
    if (d.cls === 'mage')    this._showFireballEffect(d.fromX, d.fromY, d.toX, d.toY, d.hit);
    if (d.cls === 'rogue')   this._showBlinkEffect(d.fromX, d.fromY, d.toX);
  }

  _showBashEffect(x, y, hit) {
    const ring = this.add.circle(x, y, 10, 0xff6600, 0).setDepth(8);
    ring.setStrokeStyle(3, hit ? 0xff4400 : 0x886600);
    const lbl = this.add.text(x, y - 60, 'BASH!', {
      fontSize: '20px', fontFamily: 'monospace', fontStyle: 'bold',
      color: '#ff6600', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(13);
    this.tweens.add({ targets: lbl, y: y - 100, alpha: 0, duration: 600, ease: 'Power1', onComplete: () => { if (lbl.active) lbl.destroy(); } });
    this.tweens.add({
      targets: ring, scaleX: 10, scaleY: 5, alpha: 0,
      duration: 400, ease: 'Power2',
      onComplete: () => ring.destroy(),
    });
    const flash = this.add.rectangle(W / 2, H / 2, W, H, 0xff4400, 0.1).setDepth(7);
    this.tweens.add({ targets: flash, alpha: 0, duration: 200, onComplete: () => flash.destroy() });
    if (hit) this.cameras.main.shake(140, 0.009);
  }

  _showFireballEffect(fromX, fromY, toX, toY, hit) {
    const ball = this.add.circle(fromX, fromY - 30, 11, 0xff4400).setDepth(9);
    const lbl = this.add.text(fromX, fromY - 70, 'FIREBALL!', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold',
      color: '#ff4400', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(13);
    this.tweens.add({ targets: lbl, y: fromY - 110, alpha: 0, duration: 600, ease: 'Power1', onComplete: () => { if (lbl.active) lbl.destroy(); } });
    const core = this.add.circle(fromX, fromY - 30,  5, 0xffee00).setDepth(9);

    // Fire particle trail following the ball
    const trail = this.add.particles(fromX, fromY - 30, 'fire_particle', {
      speed:    { min: 20, max: 60 },
      angle:    { min: 160, max: 200 },
      scale:    { start: 1.0, end: 0 },
      alpha:    { start: 0.85, end: 0 },
      tint:     [0xff6600, 0xff2200, 0xffcc00],
      lifespan: 180,
      quantity: 3,
      emitting: true,
    }).setDepth(8);

    this.tweens.add({
      targets: [ball, core], x: toX, y: toY - 30,
      duration: 320, ease: 'Linear',
      onUpdate: () => {
        if (ball.active) trail.setPosition(ball.x, ball.y);
      },
      onComplete: () => {
        trail.destroy();
        if (ball.active) ball.destroy();
        if (core.active) core.destroy();
        if (!this.scene?.isActive()) return;

        // Impact explosion
        const blast = this.add.particles(toX, toY - 30, 'fire_particle', {
          speed: { min: 80, max: 200 },
          angle: { min: 0, max: 360 },
          scale: { start: 1.5, end: 0 },
          alpha: { start: 1, end: 0 },
          tint:  [0xff6600, 0xff2200, 0xffee00],
          lifespan: 320,
          quantity: hit ? 20 : 8,
          emitting: false,
        }).setDepth(9);
        blast.explode(hit ? 20 : 8);
        this.time.delayedCall(400, () => { if (blast.active) blast.destroy(); });

        if (hit) {
          const ring = this.add.circle(toX, toY - 30, 8, 0xff6600).setDepth(9);
          this.tweens.add({ targets: ring, scaleX: 6, scaleY: 6, alpha: 0, duration: 350, ease: 'Power2', onComplete: () => { if (ring.active) ring.destroy(); } });
          this.cameras.main.shake(90, 0.005);
        }
      },
    });
  }

  _showBlinkEffect(fromX, fromY, toX) {
    const centerY = fromY - SPRITE_HEIGHT / 2;
    const lbl = this.add.text(toX, fromY - 70, 'BLINK!', {
      fontSize: '20px', fontFamily: 'monospace', fontStyle: 'bold',
      color: '#00ffcc', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(13);
    this.tweens.add({ targets: lbl, y: fromY - 110, alpha: 0, duration: 600, ease: 'Power1', onComplete: () => { if (lbl.active) lbl.destroy(); } });

    // Smoke burst at departure point
    const depart = this.add.particles(fromX, centerY, 'smoke_particle', {
      speed:    { min: 30, max: 90 },
      angle:    { min: 0, max: 360 },
      scale:    { start: 1.4, end: 0 },
      alpha:    { start: 0.7, end: 0 },
      tint:     [0x00ffcc, 0x00ccaa, 0xaaffee],
      lifespan: 380,
      quantity: 12,
      emitting: false,
    }).setDepth(6);
    depart.explode(12);
    this.time.delayedCall(500, () => { if (depart.active) depart.destroy(); });

    // Ghost silhouette fades out
    const ghost = this.add.rectangle(fromX, centerY, 42, 72, 0x00ffcc, 0.4).setDepth(6);
    this.tweens.add({ targets: ghost, alpha: 0, scaleY: 0.3, duration: 240, ease: 'Power2', onComplete: () => { if (ghost.active) ghost.destroy(); } });

    // Arrival: smoke + flash
    this.time.delayedCall(160, () => {
      if (!this.scene?.isActive()) return;

      const arrive = this.add.particles(toX, centerY, 'smoke_particle', {
        speed:    { min: 40, max: 110 },
        angle:    { min: 0, max: 360 },
        scale:    { start: 1.6, end: 0 },
        alpha:    { start: 0.85, end: 0 },
        tint:     [0x00ffcc, 0x00ccaa, 0xaaffee],
        lifespan: 350,
        quantity: 16,
        emitting: false,
      }).setDepth(6);
      arrive.explode(16);
      this.time.delayedCall(450, () => { if (arrive.active) arrive.destroy(); });

      const flash = this.add.circle(toX, fromY - 30, 22, 0x00ffcc, 0.8).setDepth(6);
      this.tweens.add({ targets: flash, scaleX: 4.5, scaleY: 4.5, alpha: 0, duration: 320, ease: 'Power2', onComplete: () => { if (flash.active) flash.destroy(); } });
    });
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
      if (s.weapon?.active) s.weapon.setY(vy);
      if (s.aura?.active) s.aura.setY(vy - SPRITE_HEIGHT / 2);
    });
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
