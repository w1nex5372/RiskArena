import Phaser from 'phaser';
import { BACKEND_URL } from '../../../utils/constants';

const W = 800;
const H = 280;

// ── LPC player sprite constants ───────────────────────────────────────────────
const GENERATED_FRAME_SIZE = 128;
const makeF = (cols) => (row, col) => row * cols + col;

const ANIM_ROW_DEFS = {
  idle:   { rowFn: (F) => [F(11, 0)],                                    rate: 1,  loop: -1 },
  walk:   { rowFn: (F) => Array.from({ length: 9 }, (_, i) => F(11, i)), rate: 9,  loop: -1 },
  attack: { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(15, i)), rate: 12, loop: -1 },
  hurt:   { rowFn: (F) => [F(20, 0), F(20, 1), F(20, 2)],               rate: 8,  loop: 0  },
};

const CLASS_COLORS = { warrior: 0xe74c3c, mage: 0x9b59b6, rogue: 0x2ecc71 };

// ── Wartotaur boss constants ───────────────────────────────────────────────────
const BOSS_SHEET = '/characters/boss/wartotaur.png';
const BOSS_FRAME = 128;   // px per frame (896 / 7 = 128)
const BOSS_COLS  = 7;     // columns in the 896×896 spritesheet
const BOSS_SCALE = 1.8;   // 128 × 1.8 ≈ 230 px tall on canvas
const BF = (row, col) => row * BOSS_COLS + col;

// Spritesheet rows (verified from visual analysis):
//   Row 0: walk east  (cols 0-3, 4 frames)  → idle loop, flipped to face left
//   Row 3: attack     (cols 0-4, 5 frames)  → hurt reaction
//   Row 6: death/fall (cols 0-4, 5 frames)  → boss death
const BOSS_ANIM_DEFS = {
  idle:   { frames: [BF(0,0), BF(0,1), BF(0,2), BF(0,3)],                   rate: 5,  loop: -1 },
  attack: { frames: [BF(3,0), BF(3,1), BF(3,2), BF(3,3), BF(3,4)],          rate: 10, loop: 0  },
  death:  { frames: [BF(6,0), BF(6,1), BF(6,2), BF(6,3), BF(6,4)],          rate: 7,  loop: 0  },
};

// Boss position (right half of canvas, vertically centered)
const BOSS_X = 580;
const BOSS_Y = 150;

// Player column (left side, vertical stack of 5 slots)
const PLAYER_X      = 160;
const PLAYER_Y_LIST = [40, 85, 130, 175, 220];
const PLAYER_SCALE  = 0.6;

function resolveSheetUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/generated/')) return `${BACKEND_URL}${path}`;
  return path;
}

// ── BossRaidScene ─────────────────────────────────────────────────────────────
export default class BossRaidScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BossRaidScene' });

    this._raidData      = null;
    this._bossPhase     = 1;
    this._bossHp        = 1;
    this._bossMaxHp     = 1;
    this._bossStatus    = 'active';

    this._bossSprite     = null;  // Wartotaur Phaser.GameObjects.Sprite
    this._bossLabel      = null;  // boss name text
    this._hurtFlash      = null;  // red overlay flashed on each hit
    this._bossPulseTween = null;
    this._bossDeadPlayed = false;

    this._playerSlots  = [];
    this._dynamicLoads = new Set();
    this._sceneReady   = false;
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
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  create() {
    try {
      this._buildBackground();
      this._registerBossAnimations();
      this._buildBoss();
      this._buildPlayerSlots();
      this._buildConnectorLines();
      this._sceneReady = true;
      if (this._raidData) this._applyRaidData(this._raidData);
    } catch (err) {
      console.error('[BossRaidScene] create() failed:', err);
      this._sceneReady = true;
      this.add.text(W / 2, H / 2, `Boss scene error\n${err?.message || ''}`, {
        fontSize: '14px', fontFamily: 'monospace', color: '#ef4444',
        align: 'center', backgroundColor: 'rgba(0,0,0,0.75)',
        padding: { x: 10, y: 8 },
      }).setOrigin(0.5).setDepth(100);
    }
  }

  // ── Background ───────────────────────────────────────────────────────────────
  _buildBackground() {
    const g = this.add.graphics().setDepth(0);
    const steps = 16;
    const topR = 0x0d, topG = 0x0d, topB = 0x1a;
    const botR = 0x1a, botG = 0x1a, botB = 0x2e;
    const sliceH = Math.ceil(H / steps);
    for (let i = 0; i < steps; i++) {
      const t  = i / (steps - 1);
      const r  = Math.round(topR + (botR - topR) * t);
      const gv = Math.round(topG + (botG - topG) * t);
      const b  = Math.round(topB + (botB - topB) * t);
      g.fillStyle((r << 16) | (gv << 8) | b, 1);
      g.fillRect(0, i * sliceH, W, sliceH + 1);
    }
    const div = this.add.graphics().setDepth(1);
    div.lineStyle(1, 0xffffff, 0.04);
    div.beginPath();
    div.moveTo(360, 0);
    div.lineTo(360, H);
    div.strokePath();
  }

  // ── Register Wartotaur animations ────────────────────────────────────────────
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

  // ── Wartotaur sprite (falls back to rect if texture failed) ──────────────────
  _buildBoss() {
    const spriteReady = this.textures.exists('wartotaur');

    if (spriteReady) {
      this._bossSprite = this.add.sprite(BOSS_X, BOSS_Y, 'wartotaur')
        .setOrigin(0.5, 0.5)
        .setScale(BOSS_SCALE)
        .setFlipX(true)   // face left toward the player column
        .setDepth(5);
      this._bossSprite.play('boss_idle');
    } else {
      // Fallback placeholder if sprite failed to load
      const g = this.add.graphics().setDepth(5);
      g.fillStyle(0x8b0000, 1);
      g.fillRect(BOSS_X - 60, BOSS_Y - 80, 120, 160);
      g.lineStyle(2, 0xcc2200, 0.8);
      g.strokeRect(BOSS_X - 60, BOSS_Y - 80, 120, 160);
      g.fillStyle(0xff0000, 0.9);
      g.fillRect(BOSS_X - 20, BOSS_Y - 30, 12, 10);
      g.fillRect(BOSS_X + 8,  BOSS_Y - 30, 12, 10);
      this._bossSprite = g;
    }

    // Boss name label
    const labelY = BOSS_Y - (BOSS_FRAME * BOSS_SCALE) / 2 - 12;
    this._bossLabel = this.add.text(BOSS_X, labelY, 'BOSS', {
      fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold',
      color: '#ef4444', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(7);

    // Red hit-flash overlay (covers the sprite bounding box)
    const hw = (BOSS_FRAME * BOSS_SCALE) / 2;
    this._hurtFlash = this.add.graphics().setDepth(8).setAlpha(0);
    this._hurtFlash.fillStyle(0xff3300, 0.65);
    this._hurtFlash.fillRect(BOSS_X - hw, BOSS_Y - hw, hw * 2, hw * 2);

    this._bossStartIdle();
  }

  // ── Player slots (left column) ───────────────────────────────────────────────
  _buildPlayerSlots() {
    this._playerSlots = [];
    for (let i = 0; i < 5; i++) {
      const x = PLAYER_X;
      const y = PLAYER_Y_LIST[i];
      const placeholder = this.add.graphics().setDepth(4).setAlpha(0);
      placeholder.fillStyle(0x334466, 0.8);
      placeholder.fillRect(-20, -24, 40, 48);
      const nameText = this.add.text(x, y + 28, '', {
        fontSize: '9px', fontFamily: 'monospace',
        color: '#94a3b8', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 0).setDepth(4).setVisible(false);
      this._playerSlots.push({ x, y, placeholder, sprite: null, nameText, cls: null, sheetKey: null, active: false, oscillationTween: null });
    }
  }

  // ── Dotted connector lines from player column to boss ────────────────────────
  _buildConnectorLines() {
    const g        = this.add.graphics().setDepth(2);
    const bossEdge = BOSS_X - (BOSS_FRAME * BOSS_SCALE) / 2 - 10;
    g.lineStyle(1, 0x334466, 0.3);
    for (let i = 0; i < 5; i++) {
      const py = PLAYER_Y_LIST[i];
      for (let dx = PLAYER_X + 30; dx < bossEdge; dx += 14) {
        g.beginPath();
        g.moveTo(dx, py);
        g.lineTo(Math.min(dx + 8, bossEdge), py);
        g.strokePath();
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
    const startX  = BOSS_X + Phaser.Math.Between(-60, 60);
    const startY  = BOSS_Y - 20 + Phaser.Math.Between(-40, 40);
    const txt = this.add.text(startX, startY, `-${damage}`, {
      fontSize: size, fontFamily: 'monospace', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: txt, y: startY - 48,
      alpha: { from: 1, to: 0 },
      duration: 700, ease: 'Power2',
      onComplete: () => { if (txt.active) txt.destroy(); },
    });
  }

  onRaidFinished(data) {
    if (!this._sceneReady) return;
    this._bossStatus = data?.status || 'defeated';
    if (this._bossStatus === 'defeated') this._bossDeath();
    this._playerSlots.forEach((slot) => {
      if (slot.sprite?.active) {
        this.tweens.add({ targets: slot.sprite, alpha: 0.3, duration: 800 });
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INTERNALS
  // ─────────────────────────────────────────────────────────────────────────────

  _applyRaidData(opts) {
    if (!opts) return;
    this._bossHp    = opts.bossHp    ?? this._bossHp;
    this._bossMaxHp = opts.bossMaxHp ?? this._bossMaxHp;
    this._bossPhase = opts.bossPhase ?? 1;
    if (this._bossLabel && opts.bossName) this._bossLabel.setText(opts.bossName.toUpperCase());
    this._applyPhaseVisuals(this._bossPhase);
    const attackers = Array.isArray(opts.recentAttackers) ? opts.recentAttackers : [];
    [opts.myPlayer, ...attackers].filter(Boolean).slice(0, 5)
      .forEach((p, i) => this._populatePlayerSlot(i, p));
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
      duration: 1200,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });
  }

  _bossHurt() {
    // Red overlay flash
    if (this._hurtFlash?.active) {
      this.tweens.killTweensOf(this._hurtFlash);
      this._hurtFlash.setAlpha(0.7);
      this.tweens.add({ targets: this._hurtFlash, alpha: 0, duration: 150, ease: 'Power2' });
    }
    // Camera shake
    if (this.cameras?.main) this.cameras.main.shake(60, 0.004);
  }

  _bossDeath() {
    if (this._bossDeadPlayed) return;
    this._bossDeadPlayed = true;
    if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }
    if (!this._bossSprite?.active) return;

    // Kill pulse tween and any others on the sprite
    this.tweens.killTweensOf(this._bossSprite);

    if (this._bossSprite.play) {
      this._bossSprite.play('boss_death');
      this._bossSprite.once('animationcomplete', () => {
        if (this._bossSprite?.active) {
          this.tweens.add({ targets: this._bossSprite, alpha: 0, duration: 500, ease: 'Power2' });
        }
      });
    } else {
      // Fallback graphics rect
      this.tweens.add({ targets: this._bossSprite, alpha: 0, duration: 600, ease: 'Power2' });
    }

    if (this._bossLabel?.active) {
      this.tweens.add({ targets: this._bossLabel, alpha: 0, duration: 400 });
    }
    this._spawnDeathParticles();
  }

  _applyPhaseVisuals(phase) {
    if (!this._bossSprite?.active) return;

    if (phase === 2) {
      if (this._bossSprite.setTint) this._bossSprite.setTint(0xffaa44); // orange
    } else if (phase >= 3) {
      if (this._bossSprite.setTint) this._bossSprite.setTint(0xff4444); // enraged red
      // Faster pulse in phase 3
      if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }
      this._bossPulseTween = this.tweens.add({
        targets:  this._bossSprite,
        scaleX:   { from: BOSS_SCALE * 0.94, to: BOSS_SCALE * 1.06 },
        scaleY:   { from: BOSS_SCALE * 0.94, to: BOSS_SCALE * 1.06 },
        duration: 500,
        yoyo:     true,
        repeat:   -1,
        ease:     'Sine.easeInOut',
      });
    } else {
      if (this._bossSprite.clearTint) this._bossSprite.clearTint();
      this._bossStartIdle();
    }
  }

  _spawnDeathParticles() {
    const count  = 18;
    const colors = [0xef4444, 0xff6600, 0xfbbf24, 0x8b0000];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = Phaser.Math.Between(40, 100);
      const size  = Phaser.Math.Between(3, 8);
      const color = Phaser.Utils.Array.GetRandom(colors);
      const g = this.add.graphics().setDepth(10);
      g.fillStyle(color, 1);
      g.fillRect(-size / 2, -size / 2, size, size);
      g.x = BOSS_X;
      g.y = BOSS_Y;
      this.tweens.add({
        targets: g,
        x: BOSS_X + Math.cos(angle) * speed,
        y: BOSS_Y + Math.sin(angle) * speed,
        alpha: 0, duration: 700, ease: 'Power2',
        delay: Phaser.Math.Between(0, 120),
        onComplete: () => { if (g.active) g.destroy(); },
      });
    }
  }

  // ── Player slot management ────────────────────────────────────────────────────

  _populatePlayerSlot(index, playerData) {
    if (index >= this._playerSlots.length || !playerData) return;
    const slot      = this._playerSlots[index];
    slot.active     = true;
    const cls       = String(playerData.class_name || playerData.class || playerData.character_class || 'warrior').toLowerCase();
    const sheetPath = playerData.sheetPath || playerData.character_spritesheet_path || null;
    const username  = playerData.username || playerData.first_name || `P${index + 1}`;
    slot.cls = cls;
    slot.nameText.setText(username.slice(0, 8));
    slot.nameText.setVisible(true);
    if (sheetPath && sheetPath.startsWith('/generated/')) {
      this._loadGeneratedSheet(slot, index, cls, sheetPath);
    } else {
      this._spawnFallbackRect(slot, index, cls);
    }
  }

  _loadGeneratedSheet(slot, index, cls, sheetPath) {
    const url = resolveSheetUrl(sheetPath);
    if (!url) { this._spawnFallbackRect(slot, index, cls); return; }
    const safeKey = `boss_player_${sheetPath.replace(/[^A-Za-z0-9]/g, '_')}`;
    slot.sheetKey  = safeKey;
    const afterLoad = () => {
      if (!this.textures.exists(safeKey)) { this._spawnFallbackRect(slot, index, cls); return; }
      this._registerSlotAnimations(safeKey, safeKey);
      this._spawnLpcSprite(slot, index, safeKey, GENERATED_FRAME_SIZE, 13);
    };
    if (this.textures.exists(safeKey)) { afterLoad(); return; }
    if (this._dynamicLoads.has(safeKey)) return;
    this._dynamicLoads.add(safeKey);
    this.load.spritesheet(safeKey, url, { frameWidth: GENERATED_FRAME_SIZE, frameHeight: GENERATED_FRAME_SIZE });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => { this._dynamicLoads.delete(safeKey); afterLoad(); });
    if (!this.load.isLoading()) this.load.start();
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

  // eslint-disable-next-line no-unused-vars
  _spawnLpcSprite(slot, index, textureKey, frameSize, _cols) {
    const { x, y } = slot;
    if (slot.oscillationTween) { slot.oscillationTween.stop(); slot.oscillationTween = null; }
    if (slot.sprite?.active)   slot.sprite.destroy();
    if (slot.placeholder)      slot.placeholder.setAlpha(0);
    const sprite = this.add.sprite(x, y, textureKey)
      .setOrigin(0.5, frameSize === GENERATED_FRAME_SIZE ? 0.75 : 1.0)
      .setScale(PLAYER_SCALE)
      .setDepth(4)
      .setFlipX(true);
    slot.sprite = sprite;
    const attackKey = `${textureKey}_attack`;
    const idleKey   = `${textureKey}_idle`;
    if      (this.anims.exists(attackKey)) sprite.play(attackKey);
    else if (this.anims.exists(idleKey))   sprite.play(idleKey);
    slot.oscillationTween = this._addAttackOscillation(sprite, index);
  }

  _spawnFallbackRect(slot, index, cls) {
    const { x, y } = slot;
    if (slot.oscillationTween) { slot.oscillationTween.stop(); slot.oscillationTween = null; }
    if (slot.sprite?.active)   slot.sprite.destroy();
    const g     = this.add.graphics().setDepth(4);
    const color = CLASS_COLORS[cls] ?? 0x888888;
    g.fillStyle(color, 0.85);
    g.fillRect(x - 14, y - 30, 28, 40);
    g.lineStyle(1, 0xffffff, 0.25);
    g.strokeRect(x - 14, y - 30, 28, 40);
    const letter = this.add.text(x, y - 10, cls[0].toUpperCase(), {
      fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5).setDepth(5);
    const container = this.add.container(0, 0, [g, letter]).setDepth(4);
    slot.sprite    = container;
    slot.sheetKey  = `fb_${cls}`; // prevents unnecessary re-creation on next boss_update
    slot.oscillationTween = this._addAttackOscillation(container, index);
  }

  _addAttackOscillation(target, index) {
    return this.tweens.add({
      targets: target, x: `+=${8}`,
      duration: 300, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: index * 160,
    });
  }

  _refreshAttackers(attackers) {
    attackers.slice(0, 4).forEach((attacker, i) => {
      const slotIndex = i + 1;
      if (slotIndex >= this._playerSlots.length) return;
      const slot    = this._playerSlots[slotIndex];
      const newPath = attacker.sheetPath || attacker.character_spritesheet_path || null;
      const newCls  = String(attacker.class_name || attacker.class || 'warrior').toLowerCase();
      const prevKey = slot.sheetKey || '';
      const newKey  = newPath
        ? `boss_player_${newPath.replace(/[^A-Za-z0-9]/g, '_')}`
        : `fb_${newCls}`;
      if (slot.active && prevKey === newKey) return;
      this._populatePlayerSlot(slotIndex, attacker);
    });
  }
}
