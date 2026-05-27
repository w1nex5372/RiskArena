import Phaser from 'phaser';
import { BACKEND_URL } from '../../../utils/constants';

const W = 800;
const H = 460;

// ── LPC player sprite constants ───────────────────────────────────────────────
const GENERATED_FRAME_SIZE = 128; // composited user sheets
const CLASS_FRAME_SIZE     = 64;  // default /characters/{cls}_sheet.png
const LPC_COLS             = 13;  // both generated and default sheets use 13 cols
const makeF = (cols) => (row, col) => row * cols + col;

// Works for both 64px and 128px sheets — same LPC row layout
const ANIM_ROW_DEFS = {
  idle:   { rowFn: (F) => [F(11, 0)],                                    rate: 1,  loop: -1 },
  walk:   { rowFn: (F) => Array.from({ length: 9 }, (_, i) => F(11, i)), rate: 9,  loop: -1 },
  attack: { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(15, i)), rate: 12, loop: 0  },
  hurt:   { rowFn: (F) => [F(20, 0), F(20, 1), F(20, 2)],               rate: 8,  loop: 0  },
};

const CLASS_COLORS = { warrior: 0xe74c3c, mage: 0x9b59b6, rogue: 0x2ecc71 };
// Scale for each sheet type so rendered height matches
const GENERATED_SCALE  = 1.3;  // 128 × 1.3 ≈ 166px
const CLASS_SCALE      = 2.0;  // 64  × 2.0 = 128px
const ATTACKER_GENERATED_SCALE = 0.9;
const ATTACKER_CLASS_SCALE     = 1.5;

// ── Wartotaur boss constants ──────────────────────────────────────────────────
const BOSS_SHEET = '/characters/boss/wartotaur.png';
const BOSS_FRAME = 128;
const BOSS_COLS  = 7;
const BOSS_SCALE = 2.8;
const BF = (row, col) => row * BOSS_COLS + col;

const BOSS_ANIM_DEFS = {
  idle:   { frames: [BF(0,0), BF(0,1), BF(0,2), BF(0,3)],               rate: 5,  loop: -1 },
  attack: { frames: [BF(3,0), BF(3,1), BF(3,2), BF(3,3), BF(3,4)],      rate: 10, loop: 0  },
  death:  { frames: [BF(6,0), BF(6,1), BF(6,2), BF(6,3), BF(6,4)],      rate: 7,  loop: 0  },
};

const GROUND_Y       = 360;
const BOSS_X         = 610;
const BOSS_Y         = GROUND_Y;
const PLAYER_START_X = 90;
const PLAYER_STOP_X  = 390;
const PLAYER_SPEED   = 200;

// Other attackers clustered near boss
const ATTACKER_SLOTS_X = [430, 455, 400, 480, 375];

function resolveSheetUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/generated/')) return `${BACKEND_URL}${path}`;
  return path;
}

export default class BossRaidScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BossRaidScene' });

    this._raidData       = null;
    this._bossPhase      = 1;
    this._bossHp         = 1;
    this._bossMaxHp      = 1;
    this._bossStatus     = 'active';

    this._bossSprite      = null;
    this._bossLabel       = null;
    this._hurtFlash       = null;
    this._bossPulseTween  = null;
    this._bossDeadPlayed  = false;
    this._bossAttackTimer = null;
    this._bossIsAttacking = false;

    // My player
    this._myPlayerSprite = null;
    this._myPlayerX      = PLAYER_START_X;
    this._myPlayerState  = 'idle'; // 'idle' | 'walk' | 'attacking'
    this._myAnimKey      = null;
    this._myPlayerFacing = 1; // 1 = right, -1 = left

    // Joystick input flags (set from React via setJoystickInput)
    this._joystickLeft   = false;
    this._joystickRight  = false;

    // Other attackers
    this._attackerSlots  = [];
    this._dynamicLoads   = new Set();
    this._sceneReady     = false;
  }

  // ── Preload ──────────────────────────────────────────────────────────────────
  preload() {
    this.load.on('loaderror', (file) => {
      console.warn('[BossRaidScene] asset missing:', file.key, file.src);
    });
    this.load.spritesheet('wartotaur', BOSS_SHEET, {
      frameWidth:  BOSS_FRAME,
      frameHeight: BOSS_FRAME,
    });
    // Default class spritesheets — used when no generated user sheet exists
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      this.load.spritesheet(`cls_${cls}`, `/characters/${cls}_sheet.png`, {
        frameWidth:  CLASS_FRAME_SIZE,
        frameHeight: CLASS_FRAME_SIZE,
      });
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  create() {
    try {
      this._buildBackground();
      this._buildGround();
      this._registerBossAnimations();
      this._registerClassAnimations();
      this._buildBoss();
      this._buildAttackerSlots();
      this._sceneReady = true;
      if (this._raidData) this._applyRaidData(this._raidData);
      this._startBossAttackLoop();
    } catch (err) {
      console.error('[BossRaidScene] create() failed:', err);
      this._sceneReady = true;
      this.add.text(W / 2, H / 2, `Scene error\n${err?.message || ''}`, {
        fontSize: '13px', fontFamily: 'monospace', color: '#ef4444',
        align: 'center', backgroundColor: 'rgba(0,0,0,0.8)',
        padding: { x: 10, y: 8 },
      }).setOrigin(0.5).setDepth(100);
    }
  }

  // ── Update loop ───────────────────────────────────────────────────────────────
  update(_time, delta) {
    if (!this._sceneReady || !this._myPlayerSprite?.active) return;
    if (this._myPlayerState === 'attacking') return;

    const dt = delta / 1000;
    let moving = false;

    if (this._joystickLeft && this._myPlayerX > 30) {
      this._myPlayerX -= PLAYER_SPEED * dt;
      this._myPlayerFacing = -1;
      moving = true;
    } else if (this._joystickRight && this._myPlayerX < PLAYER_STOP_X) {
      this._myPlayerX += PLAYER_SPEED * dt;
      this._myPlayerFacing = 1;
      moving = true;
    }

    // Move sprite (works for both Sprite and Container)
    if (this._myPlayerSprite.x !== undefined) {
      this._myPlayerSprite.x = this._myPlayerX;
    }
    if (this._myPlayerSprite.setFlipX) {
      this._myPlayerSprite.setFlipX(this._myPlayerFacing < 0);
    }

    // Animation transitions
    if (this._myAnimKey) {
      const walkKey = `${this._myAnimKey}_walk`;
      const idleKey = `${this._myAnimKey}_idle`;
      if (moving && this._myPlayerState !== 'walk') {
        this._myPlayerState = 'walk';
        if (this.anims.exists(walkKey) && this._myPlayerSprite.play) {
          this._myPlayerSprite.play(walkKey, true);
        }
      } else if (!moving && this._myPlayerState !== 'idle') {
        this._myPlayerState = 'idle';
        if (this.anims.exists(idleKey) && this._myPlayerSprite.play) {
          this._myPlayerSprite.play(idleKey, true);
        }
      }
    } else {
      // Fallback container: shift child offset for walk illusion
      if (moving) {
        this._myPlayerSprite.x = this._myPlayerX;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API — called by BossRaidScreen.jsx
  // ─────────────────────────────────────────────────────────────────────────────

  setRaidData(opts) {
    this._raidData = opts;
    if (this._sceneReady) this._applyRaidData(opts);
  }

  onBossUpdate(data) {
    if (!this._sceneReady) return;
    const prevPhase = this._bossPhase;
    if (typeof data.current_hp === 'number') this._bossHp = data.current_hp;
    if (typeof data.max_hp     === 'number') this._bossMaxHp = data.max_hp;
    if (typeof data.phase      === 'number') this._bossPhase = data.phase;
    if (typeof data.status     === 'string') this._bossStatus = data.status;

    if (data.phase && data.phase !== prevPhase) this._applyPhaseVisuals(data.phase);
    this._bossHurt();
    if (Array.isArray(data.recent_attackers)) this._refreshAttackers(data.recent_attackers);
    if (data.status === 'defeated' || (typeof data.current_hp === 'number' && data.current_hp <= 0)) {
      this._bossDeath();
    }
  }

  showDamageNumber(damage) {
    if (!this._sceneReady || damage == null) return;
    const isLarge = damage > 20;
    const color   = isLarge ? '#ef4444' : '#fbbf24';
    const size    = isLarge ? '22px' : '18px';
    const startX  = BOSS_X + Phaser.Math.Between(-80, 80);
    const startY  = BOSS_Y - 120 + Phaser.Math.Between(-30, 30);
    const txt = this.add.text(startX, startY, `-${damage}`, {
      fontSize: size, fontFamily: 'monospace', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: txt, y: startY - 60,
      alpha: { from: 1, to: 0 },
      duration: 750, ease: 'Power2',
      onComplete: () => { if (txt.active) txt.destroy(); },
    });
  }

  onRaidFinished(data) {
    if (!this._sceneReady) return;
    this._bossStatus = data?.status || 'defeated';
    if (this._bossStatus === 'defeated') this._bossDeath();
    this._attackerSlots.forEach((slot) => {
      if (slot.sprite?.active) {
        this.tweens.add({ targets: slot.sprite, alpha: 0.3, duration: 800 });
      }
    });
    if (this._myPlayerSprite?.active && this._myAnimKey) {
      const hurtKey = `${this._myAnimKey}_hurt`;
      if (this.anims.exists(hurtKey) && this._myPlayerSprite.play) {
        this._myPlayerSprite.play(hurtKey);
      }
    }
  }

  // Called from React joystick onChange
  setJoystickInput({ left, right }) {
    this._joystickLeft  = !!left;
    this._joystickRight = !!right;
  }

  // Called from React attack button — plays attack animation once then returns to idle
  triggerPlayerAttack() {
    if (!this._sceneReady || !this._myPlayerSprite?.active) return;
    if (this._myPlayerState === 'attacking') return;

    this._myPlayerState  = 'attacking';
    this._myPlayerFacing = 1; // face boss on right
    if (this._myPlayerSprite.setFlipX) this._myPlayerSprite.setFlipX(false);

    if (this._myAnimKey) {
      const attackKey = `${this._myAnimKey}_attack`;
      const idleKey   = `${this._myAnimKey}_idle`;
      if (this.anims.exists(attackKey) && this._myPlayerSprite.play) {
        this._myPlayerSprite.play(attackKey, true);
        this._myPlayerSprite.once('animationcomplete', () => {
          this._myPlayerState = 'idle';
          if (this.anims.exists(idleKey) && this._myPlayerSprite?.active) {
            this._myPlayerSprite.play(idleKey, true);
          }
        });
      } else {
        this._myPlayerState = 'idle';
      }
    } else {
      // Fallback container: shake it
      if (this._myPlayerSprite?.active) {
        this.tweens.add({
          targets: this._myPlayerSprite,
          x: `+=${18}`,
          duration: 80, yoyo: true, repeat: 2,
          onComplete: () => { this._myPlayerState = 'idle'; },
        });
      } else {
        this._myPlayerState = 'idle';
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INTERNALS
  // ─────────────────────────────────────────────────────────────────────────────

  _buildBackground() {
    const g = this.add.graphics().setDepth(0);
    // Dark dungeon sky gradient
    const steps = 20;
    const colors = [
      [0x04, 0x02, 0x0e],
      [0x10, 0x05, 0x1a],
    ];
    const sliceH = Math.ceil(H / steps);
    for (let i = 0; i < steps; i++) {
      const t  = i / (steps - 1);
      const r  = Math.round(colors[0][0] + (colors[1][0] - colors[0][0]) * t);
      const gv = Math.round(colors[0][1] + (colors[1][1] - colors[0][1]) * t);
      const b  = Math.round(colors[0][2] + (colors[1][2] - colors[0][2]) * t);
      g.fillStyle((r << 16) | (gv << 8) | b, 1);
      g.fillRect(0, i * sliceH, W, sliceH + 1);
    }
    // Torch glow atmospherics near boss
    this._addTorchGlow(560, 280);
    this._addTorchGlow(670, 240);
  }

  _addTorchGlow(x, y) {
    const g = this.add.graphics().setDepth(1).setAlpha(0.15);
    g.fillStyle(0xff5500, 1);
    g.fillCircle(x, y, 90);
    this.tweens.add({
      targets: g,
      alpha: { from: 0.1, to: 0.22 },
      duration: 900 + Math.random() * 400,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  _buildGround() {
    const g = this.add.graphics().setDepth(1);
    // Ground fill
    g.fillStyle(0x150820, 1);
    g.fillRect(0, GROUND_Y + 2, W, H - GROUND_Y - 2);
    // Glowing ground line
    g.lineStyle(3, 0x7b2fb5, 0.7);
    g.beginPath();
    g.moveTo(0, GROUND_Y + 2);
    g.lineTo(W, GROUND_Y + 2);
    g.strokePath();
    // Subtle floor tiles
    g.lineStyle(1, 0x3a1060, 0.2);
    for (let x = 0; x < W; x += 64) {
      g.beginPath();
      g.moveTo(x, GROUND_Y + 2);
      g.lineTo(x, H);
      g.strokePath();
    }
  }

  _registerBossAnimations() {
    if (!this.textures.exists('wartotaur')) return;
    Object.entries(BOSS_ANIM_DEFS).forEach(([name, def]) => {
      const key = `boss_${name}`;
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames:    this.anims.generateFrameNumbers('wartotaur', { frames: def.frames }),
        frameRate: def.rate,
        repeat:    def.loop,
      });
    });
  }

  _registerClassAnimations() {
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      const texKey = `cls_${cls}`;
      if (!this.textures.exists(texKey)) return;
      this._registerSlotAnimations(texKey, texKey);
    });
  }

  _buildBoss() {
    const spriteReady = this.textures.exists('wartotaur');

    if (spriteReady) {
      this._bossSprite = this.add.sprite(BOSS_X, BOSS_Y, 'wartotaur')
        .setOrigin(0.5, 1.0)
        .setScale(BOSS_SCALE)
        .setFlipX(true)
        .setDepth(6);
      this._bossSprite.play('boss_idle');
    } else {
      const g = this.add.graphics().setDepth(6);
      g.fillStyle(0x8b0000, 1);
      g.fillRect(BOSS_X - 55, BOSS_Y - 155, 110, 155);
      g.lineStyle(2, 0xcc2200, 0.8);
      g.strokeRect(BOSS_X - 55, BOSS_Y - 155, 110, 155);
      this._bossSprite = g;
    }

    // Boss name label
    const labelY = BOSS_Y - BOSS_FRAME * BOSS_SCALE - 14;
    this._bossLabel = this.add.text(BOSS_X, labelY, 'BOSS', {
      fontSize: '15px', fontFamily: 'monospace', fontStyle: 'bold',
      color: '#ef4444', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(8);

    // Red hit-flash
    const hw = (BOSS_FRAME * BOSS_SCALE) / 2;
    this._hurtFlash = this.add.graphics().setDepth(9).setAlpha(0);
    this._hurtFlash.fillStyle(0xff3300, 0.60);
    this._hurtFlash.fillRect(BOSS_X - hw, BOSS_Y - hw * 2, hw * 2, hw * 2);

    this._bossStartIdle();
  }

  _buildAttackerSlots() {
    this._attackerSlots = [];
    for (let i = 0; i < 5; i++) {
      this._attackerSlots.push({
        x:             ATTACKER_SLOTS_X[i] ?? (430 + i * 22),
        y:             GROUND_Y,
        sprite:        null,
        nameText:      null,
        cls:           null,
        sheetKey:      null,
        active:        false,
        oscillationTween: null,
      });
    }
  }

  _applyRaidData(opts) {
    if (!opts) return;
    this._bossHp    = opts.bossHp    ?? this._bossHp;
    this._bossMaxHp = opts.bossMaxHp ?? this._bossMaxHp;
    this._bossPhase = opts.bossPhase ?? 1;

    if (this._bossLabel && opts.bossName) {
      this._bossLabel.setText(opts.bossName.toUpperCase());
    }
    this._applyPhaseVisuals(this._bossPhase);

    if (opts.myPlayer) this._spawnMyPlayer(opts.myPlayer);

    const attackers = Array.isArray(opts.recentAttackers) ? opts.recentAttackers : [];
    attackers.slice(0, 5).forEach((p, i) => this._populateAttackerSlot(i, p));
  }

  // ── My player spawn ───────────────────────────────────────────────────────────

  _spawnMyPlayer(playerData) {
    const cls       = String(playerData.class_name || playerData.class || 'warrior').toLowerCase();
    const sheetPath = playerData.sheetPath || playerData.character_spritesheet_path || null;

    const spawnWithKey = (texKey, frameSize) => {
      if (this._myPlayerSprite?.active) this._myPlayerSprite.destroy();
      this._registerSlotAnimations(texKey, texKey);
      const scale  = frameSize === GENERATED_FRAME_SIZE ? GENERATED_SCALE : CLASS_SCALE;
      const sprite = this.add.sprite(this._myPlayerX, GROUND_Y, texKey)
        .setOrigin(0.5, 1.0)
        .setScale(scale)
        .setDepth(5)
        .setFlipX(false);
      this._myPlayerSprite = sprite;
      this._myAnimKey      = texKey;
      const idleKey = `${texKey}_idle`;
      if (this.anims.exists(idleKey)) sprite.play(idleKey);
    };

    if (sheetPath?.startsWith('/generated/')) {
      const url     = resolveSheetUrl(sheetPath);
      const safeKey = `my_player_${sheetPath.replace(/[^A-Za-z0-9]/g, '_')}`;
      if (this.textures.exists(safeKey)) { spawnWithKey(safeKey, GENERATED_FRAME_SIZE); return; }
      if (this._dynamicLoads.has(safeKey)) return;
      this._dynamicLoads.add(safeKey);
      this.load.spritesheet(safeKey, url, { frameWidth: GENERATED_FRAME_SIZE, frameHeight: GENERATED_FRAME_SIZE });
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this._dynamicLoads.delete(safeKey);
        if (this.textures.exists(safeKey)) spawnWithKey(safeKey, GENERATED_FRAME_SIZE);
        else this._spawnClassPlayer(cls);
      });
      if (!this.load.isLoading()) this.load.start();
    } else {
      this._spawnClassPlayer(cls);
    }
  }

  _spawnClassPlayer(cls) {
    const texKey = `cls_${cls}`;
    if (this._myPlayerSprite?.active) this._myPlayerSprite.destroy();
    if (this.textures.exists(texKey)) {
      this._registerSlotAnimations(texKey, texKey);
      const sprite = this.add.sprite(this._myPlayerX, GROUND_Y, texKey)
        .setOrigin(0.5, 1.0)
        .setScale(CLASS_SCALE)
        .setDepth(5)
        .setFlipX(false);
      this._myPlayerSprite = sprite;
      this._myAnimKey      = texKey;
      const idleKey = `${texKey}_idle`;
      if (this.anims.exists(idleKey)) sprite.play(idleKey);
    } else {
      // Absolute last-resort colored rect
      const color = CLASS_COLORS[cls] ?? 0x4a90d9;
      const g = this.add.graphics().setDepth(5);
      g.fillStyle(color, 0.9);
      g.fillRect(-18, -46, 36, 46);
      g.lineStyle(2, 0xffffff, 0.3);
      g.strokeRect(-18, -46, 36, 46);
      const letter = this.add.text(0, -23, cls[0].toUpperCase(), {
        fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
      }).setOrigin(0.5);
      const container = this.add.container(this._myPlayerX, GROUND_Y, [g, letter]).setDepth(5);
      this._myPlayerSprite = container;
      this._myAnimKey      = null;
    }
  }

  // ── Other attacker slots ──────────────────────────────────────────────────────

  _populateAttackerSlot(index, playerData) {
    if (index >= this._attackerSlots.length || !playerData) return;
    const slot  = this._attackerSlots[index];
    slot.active = true;
    const cls       = String(playerData.class_name || playerData.class || 'warrior').toLowerCase();
    const sheetPath = playerData.sheetPath || playerData.character_spritesheet_path || null;
    slot.cls = cls;

    if (!slot.nameText) {
      slot.nameText = this.add.text(slot.x, slot.y - 52, '', {
        fontSize: '9px', fontFamily: 'monospace',
        color: '#94a3b8', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 1).setDepth(7).setVisible(false);
    }
    const username = playerData.username || playerData.first_name || `P${index + 1}`;
    slot.nameText.setText(username.slice(0, 8)).setVisible(true);

    if (sheetPath?.startsWith('/generated/')) {
      this._loadAttackerSheet(slot, index, cls, sheetPath);
    } else {
      this._spawnAttackerFallback(slot, index, cls);
    }
  }

  _loadAttackerSheet(slot, index, cls, sheetPath) {
    const url     = resolveSheetUrl(sheetPath);
    if (!url) { this._spawnAttackerFallback(slot, index, cls); return; }
    const safeKey = `boss_player_${sheetPath.replace(/[^A-Za-z0-9]/g, '_')}`;
    slot.sheetKey = safeKey;
    const afterLoad = () => {
      if (!this.textures.exists(safeKey)) { this._spawnAttackerFallback(slot, index, cls); return; }
      this._registerSlotAnimations(safeKey, safeKey);
      this._spawnAttackerLpc(slot, index, safeKey);
    };
    if (this.textures.exists(safeKey)) { afterLoad(); return; }
    if (this._dynamicLoads.has(safeKey)) return;
    this._dynamicLoads.add(safeKey);
    this.load.spritesheet(safeKey, url, { frameWidth: GENERATED_FRAME_SIZE, frameHeight: GENERATED_FRAME_SIZE });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => { this._dynamicLoads.delete(safeKey); afterLoad(); });
    if (!this.load.isLoading()) this.load.start();
  }

  _spawnAttackerLpc(slot, index, textureKey) {
    if (slot.oscillationTween) { slot.oscillationTween.stop(); slot.oscillationTween = null; }
    if (slot.sprite?.active) slot.sprite.destroy();
    const sprite = this.add.sprite(slot.x, slot.y, textureKey)
      .setOrigin(0.5, 1.0)
      .setScale(ATTACKER_GENERATED_SCALE)
      .setDepth(4)
      .setFlipX(true);
    slot.sprite = sprite;
    const attackKey = `${textureKey}_attack`;
    const idleKey   = `${textureKey}_idle`;
    if      (this.anims.exists(attackKey)) sprite.play(attackKey);
    else if (this.anims.exists(idleKey))   sprite.play(idleKey);
    slot.oscillationTween = this._addSlotBounce(sprite, index);
  }

  _spawnAttackerFallback(slot, index, cls) {
    const { x, y } = slot;
    if (slot.oscillationTween) { slot.oscillationTween.stop(); slot.oscillationTween = null; }
    if (slot.sprite?.active) slot.sprite.destroy();

    const texKey = `cls_${cls}`;
    if (this.textures.exists(texKey)) {
      // Use class spritesheet sprite
      this._registerSlotAnimations(texKey, texKey);
      const sprite = this.add.sprite(x, y, texKey)
        .setOrigin(0.5, 1.0)
        .setScale(ATTACKER_CLASS_SCALE)
        .setDepth(4)
        .setFlipX(true);
      slot.sprite   = sprite;
      slot.sheetKey = `cls_${cls}`;
      const attackKey = `${texKey}_attack`;
      const idleKey   = `${texKey}_idle`;
      if      (this.anims.exists(attackKey)) sprite.play(attackKey);
      else if (this.anims.exists(idleKey))   sprite.play(idleKey);
      slot.oscillationTween = this._addSlotBounce(sprite, index);
    } else {
      // Absolute last-resort colored rect
      const g     = this.add.graphics().setDepth(4);
      const color = CLASS_COLORS[cls] ?? 0x888888;
      g.fillStyle(color, 0.75);
      g.fillRect(x - 12, y - 38, 24, 38);
      g.lineStyle(1, 0xffffff, 0.2);
      g.strokeRect(x - 12, y - 38, 24, 38);
      const letter = this.add.text(x, y - 20, cls[0].toUpperCase(), {
        fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
      }).setOrigin(0.5).setDepth(5);
      const container = this.add.container(0, 0, [g, letter]).setDepth(4);
      slot.sprite   = container;
      slot.sheetKey = `fb_${cls}`;
      slot.oscillationTween = this._addSlotBounce(container, index);
    }
  }

  _addSlotBounce(target, index) {
    return this.tweens.add({
      targets: target, y: `-=${7}`,
      duration: 280, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: index * 130,
    });
  }

  _refreshAttackers(attackers) {
    attackers.slice(0, 5).forEach((attacker, i) => {
      const slot    = this._attackerSlots[i];
      if (!slot) return;
      const newPath = attacker.sheetPath || attacker.character_spritesheet_path || null;
      const newCls  = String(attacker.class_name || attacker.class || 'warrior').toLowerCase();
      const newKey  = newPath
        ? `boss_player_${newPath.replace(/[^A-Za-z0-9]/g, '_')}`
        : (this.textures.exists(`cls_${newCls}`) ? `cls_${newCls}` : `fb_${newCls}`);
      if (slot.active && slot.sheetKey === newKey) return;
      this._populateAttackerSlot(i, attacker);
    });
  }

  _registerSlotAnimations(textureKey, animPrefix) {
    const F = makeF(13);
    Object.entries(ANIM_ROW_DEFS).forEach(([name, def]) => {
      const key = `${animPrefix}_${name}`;
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames:    this.anims.generateFrameNumbers(textureKey, { frames: def.rowFn(F) }),
          frameRate: def.rate,
          repeat:    def.loop,
        });
      }
    });
  }

  // ── Boss attack loop ──────────────────────────────────────────────────────────

  _startBossAttackLoop() {
    if (this._bossAttackTimer) { this._bossAttackTimer.remove(); this._bossAttackTimer = null; }
    if (this._bossDeadPlayed) return;
    // Phase 3 attacks much faster
    const minMs = this._bossPhase >= 3 ? 1200 : this._bossPhase === 2 ? 2000 : 2800;
    const maxMs = this._bossPhase >= 3 ? 2400 : this._bossPhase === 2 ? 3500 : 5000;
    const delay = Phaser.Math.Between(minMs, maxMs);
    this._bossAttackTimer = this.time.delayedCall(delay, () => {
      if (!this._bossDeadPlayed && this._bossStatus !== 'defeated') {
        this._doBossAttack();
      }
    });
  }

  _doBossAttack() {
    if (!this._bossSprite?.active || this._bossDeadPlayed || this._bossIsAttacking) return;
    this._bossIsAttacking = true;

    // Stop the idle pulse while attacking
    if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }

    if (this._bossSprite.play) {
      this._bossSprite.play('boss_attack', true);
      // Lunge forward on frame 2 of attack, retreat on complete
      this.time.delayedCall(120, () => {
        if (this._bossSprite?.active && !this._bossDeadPlayed) {
          this.tweens.add({
            targets: this._bossSprite,
            x: BOSS_X - 40,
            duration: 120, ease: 'Power2',
            yoyo: true, hold: 60,
          });
        }
      });
      this._bossSprite.once('animationcomplete', () => {
        this._bossIsAttacking = false;
        if (!this._bossDeadPlayed) {
          this._bossStartIdle();
          this._startBossAttackLoop();
        }
      });
    } else {
      // Fallback graphics: shake and flash
      this.tweens.add({
        targets: this._bossSprite, x: BOSS_X - 30,
        duration: 80, yoyo: true, repeat: 2,
        onComplete: () => {
          this._bossIsAttacking = false;
          if (!this._bossDeadPlayed) {
            this._bossStartIdle();
            this._startBossAttackLoop();
          }
        },
      });
    }

    // Slash effect sweeping toward the left (toward players)
    this._spawnBossSlash();

    // Phase 3: screen shake on every attack
    if (this._bossPhase >= 3 && this.cameras?.main) {
      this.cameras.main.shake(80, 0.006);
    }
  }

  _spawnBossSlash() {
    // A red crescent arc that sweeps left from the boss toward the player area
    const startX = BOSS_X - 80;
    const startY = BOSS_Y - 80;
    const g = this.add.graphics().setDepth(12);
    const color = this._bossPhase >= 3 ? 0xff2200 : this._bossPhase === 2 ? 0xff6600 : 0xcc2200;
    g.fillStyle(color, 0.85);
    // Draw a crescent-like wedge
    g.slice(0, 0, 55, Phaser.Math.DegToRad(150), Phaser.Math.DegToRad(210), false);
    g.fillPath();
    g.x = startX;
    g.y = startY;
    this.tweens.add({
      targets: g,
      x: startX - 140,
      scaleX: { from: 1, to: 0.2 },
      alpha: { from: 0.85, to: 0 },
      duration: 280, ease: 'Power2',
      onComplete: () => { if (g.active) g.destroy(); },
    });
  }

  // ── Boss animation helpers ────────────────────────────────────────────────────

  _bossStartIdle() {
    if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }
    if (!this._bossSprite?.active) return;
    if (this._bossSprite.play) this._bossSprite.play('boss_idle');
    this._bossPulseTween = this.tweens.add({
      targets:  this._bossSprite,
      scaleX:   { from: BOSS_SCALE * 0.97, to: BOSS_SCALE * 1.03 },
      scaleY:   { from: BOSS_SCALE * 0.97, to: BOSS_SCALE * 1.03 },
      duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  _bossHurt() {
    if (this._hurtFlash?.active) {
      this.tweens.killTweensOf(this._hurtFlash);
      this._hurtFlash.setAlpha(0.7);
      this.tweens.add({ targets: this._hurtFlash, alpha: 0, duration: 150, ease: 'Power2' });
    }
    if (this.cameras?.main) this.cameras.main.shake(60, 0.005);
  }

  _bossDeath() {
    if (this._bossDeadPlayed) return;
    this._bossDeadPlayed = true;
    if (this._bossAttackTimer) { this._bossAttackTimer.remove(); this._bossAttackTimer = null; }
    if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }
    if (!this._bossSprite?.active) return;
    this.tweens.killTweensOf(this._bossSprite);
    if (this._bossSprite.play) {
      this._bossSprite.play('boss_death');
      this._bossSprite.once('animationcomplete', () => {
        if (this._bossSprite?.active) {
          this.tweens.add({ targets: this._bossSprite, alpha: 0, duration: 500 });
        }
      });
    } else {
      this.tweens.add({ targets: this._bossSprite, alpha: 0, duration: 600 });
    }
    if (this._bossLabel?.active) this.tweens.add({ targets: this._bossLabel, alpha: 0, duration: 400 });
    this._spawnDeathParticles();
  }

  _applyPhaseVisuals(phase) {
    if (!this._bossSprite?.active) return;
    if (phase === 2) {
      if (this._bossSprite.setTint) this._bossSprite.setTint(0xffaa44);
      // Roar — quick forward lunge + screen flash
      this._bossPhaseRoar();
    } else if (phase >= 3) {
      if (this._bossSprite.setTint) this._bossSprite.setTint(0xff4444);
      if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }
      this._bossPulseTween = this.tweens.add({
        targets:  this._bossSprite,
        scaleX:   { from: BOSS_SCALE * 0.94, to: BOSS_SCALE * 1.06 },
        scaleY:   { from: BOSS_SCALE * 0.94, to: BOSS_SCALE * 1.06 },
        duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      this._bossPhaseRoar();
    } else {
      if (this._bossSprite.clearTint) this._bossSprite.clearTint();
      this._bossStartIdle();
    }
    // Restart attack loop with updated phase timing
    this._startBossAttackLoop();
  }

  _bossPhaseRoar() {
    if (this.cameras?.main) this.cameras.main.shake(180, 0.01);
    // White flash overlay across the whole scene
    const flash = this.add.graphics().setDepth(30);
    flash.fillStyle(0xffffff, 0.18);
    flash.fillRect(0, 0, W, H);
    this.tweens.add({ targets: flash, alpha: 0, duration: 300, onComplete: () => { if (flash.active) flash.destroy(); } });
    // Boss lurches forward
    if (this._bossSprite?.active) {
      this.tweens.add({ targets: this._bossSprite, x: BOSS_X - 60, duration: 150, yoyo: true, ease: 'Power3' });
    }
  }

  _spawnDeathParticles() {
    const count  = 24;
    const colors = [0xef4444, 0xff6600, 0xfbbf24, 0x8b0000];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = Phaser.Math.Between(60, 140);
      const size  = Phaser.Math.Between(3, 9);
      const color = Phaser.Utils.Array.GetRandom(colors);
      const g = this.add.graphics().setDepth(15);
      g.fillStyle(color, 1);
      g.fillRect(-size / 2, -size / 2, size, size);
      g.x = BOSS_X;
      g.y = BOSS_Y - 100;
      this.tweens.add({
        targets: g,
        x: BOSS_X + Math.cos(angle) * speed,
        y: (BOSS_Y - 100) + Math.sin(angle) * speed,
        alpha: 0, duration: 800, ease: 'Power2',
        delay: Phaser.Math.Between(0, 150),
        onComplete: () => { if (g.active) g.destroy(); },
      });
    }
  }
}
