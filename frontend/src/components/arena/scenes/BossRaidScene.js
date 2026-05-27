import Phaser from 'phaser';
import { BACKEND_URL } from '../../../utils/constants';

// Canvas dimensions
const W = 800;
const H = 280;

// LPC spritesheet constants (same as BattleScene.js)
// eslint-disable-next-line no-unused-vars
const FRAME_SIZE = 64;          // default per-frame size for fallback (kept for reference)
const GENERATED_FRAME_SIZE = 128; // generated /generated/ sheets are 128px frames
const makeF = (cols) => (row, col) => row * cols + col;

// LPC animation rows
const ANIM_ROW_DEFS = {
  idle:   { rowFn: (F) => [F(11, 0)],                                    rate: 1,  loop: -1 },
  walk:   { rowFn: (F) => Array.from({ length: 9 }, (_, i) => F(11, i)), rate: 9,  loop: -1 },
  attack: { rowFn: (F) => Array.from({ length: 6 }, (_, i) => F(15, i)), rate: 12, loop: -1 },
  hurt:   { rowFn: (F) => [F(20, 0), F(20, 1), F(20, 2)],               rate: 8,  loop: 0  },
};

// Class-specific fallback colors (matches BattleScene)
const CLASS_COLORS = { warrior: 0xe74c3c, mage: 0x9b59b6, rogue: 0x2ecc71 };

// Boss position (center-right of canvas)
const BOSS_X = 580;
const BOSS_Y = 140;
const BOSS_W = 120;
const BOSS_H = 160;

// Player column positions (left side, vertical stack)
const PLAYER_X      = 160;
const PLAYER_Y_LIST = [40, 85, 130, 175, 220];
const PLAYER_SCALE  = 0.6;

// ── Backend URL helper (same pattern as CharPreview.jsx) ──────────────────────
function resolveSheetUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  // /generated/ paths live on the backend
  if (path.startsWith('/generated/')) {
    return `${BACKEND_URL}${path}`;
  }
  return path;
}

// ── BossRaidScene ─────────────────────────────────────────────────────────────
export default class BossRaidScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BossRaidScene' });

    // Public state
    this._raidData      = null;
    this._bossPhase     = 1;
    this._bossHp        = 1;
    this._bossMaxHp     = 1;
    this._bossStatus    = 'active'; // 'active' | 'defeated'

    // Boss visuals
    this._bossRect      = null;
    this._bossLabel     = null;
    this._bossContainer = null;
    this._bossPulseTween = null;
    this._phaseOverlay  = null;
    this._bossGlow      = null;

    // Player slots
    this._playerSlots   = []; // [{sprite|rect, nameText, cls, sheetKey}]
    this._dynamicLoads  = new Set();

    this._sceneReady    = false;
  }

  // ── Preload ─────────────────────────────────────────────────────────────────
  preload() {
    this.load.on('loaderror', (file) => {
      console.warn('[BossRaidScene] asset missing:', file.key, file.src);
    });
  }

  // ── Create ──────────────────────────────────────────────────────────────────
  create() {
    try {
      this._buildBackground();
      this._buildBoss();
      this._buildPlayerSlots();
      this._buildConnectorLines();
      this._sceneReady = true;

      // If setRaidData was called before scene was ready, apply it now
      if (this._raidData) {
        this._applyRaidData(this._raidData);
      }
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

  // ── Background: dark gradient from #0d0d1a (top) to #1a1a2e (bottom) ────────
  _buildBackground() {
    const g = this.add.graphics().setDepth(0);
    const steps = 16;
    const topR = 0x0d, topG = 0x0d, topB = 0x1a;
    const botR = 0x1a, botG = 0x1a, botB = 0x2e;
    const sliceH = Math.ceil(H / steps);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const r = Math.round(topR + (botR - topR) * t);
      const gv = Math.round(topG + (botG - topG) * t);
      const b = Math.round(topB + (botB - topB) * t);
      const col = (r << 16) | (gv << 8) | b;
      g.fillStyle(col, 1);
      g.fillRect(0, i * sliceH, W, sliceH + 1);
    }

    // Subtle horizontal divider line in the middle-right section
    const divider = this.add.graphics().setDepth(1);
    divider.lineStyle(1, 0xffffff, 0.04);
    divider.beginPath();
    divider.moveTo(360, 0);
    divider.lineTo(360, H);
    divider.strokePath();
  }

  // ── Boss visual (placeholder for Wartotaur) ──────────────────────────────────
  // TODO: Replace with Wartotaur spritesheet when downloaded
  _buildBoss() {
    this._bossContainer = this.add.container(BOSS_X, BOSS_Y).setDepth(5);

    // Phase tint overlay (initially invisible; becomes visible in phases 2+)
    this._phaseOverlay = this.add.graphics().setDepth(6);

    // Main boss rectangle placeholder
    this._bossRect = this.add.graphics();
    this._bossRect.fillStyle(0x8b0000, 1);
    this._bossRect.fillRect(-BOSS_W / 2, -BOSS_H / 2, BOSS_W, BOSS_H);
    // Add a slightly lighter border
    this._bossRect.lineStyle(2, 0xcc2200, 0.8);
    this._bossRect.strokeRect(-BOSS_W / 2, -BOSS_H / 2, BOSS_W, BOSS_H);
    // Inner detail lines to make it look like armor
    this._bossRect.lineStyle(1, 0xff4400, 0.3);
    this._bossRect.strokeRect(-BOSS_W / 2 + 8, -BOSS_H / 2 + 8, BOSS_W - 16, BOSS_H - 16);
    // Eye glows
    this._bossRect.fillStyle(0xff0000, 0.9);
    this._bossRect.fillRect(-20, -30, 12, 10);
    this._bossRect.fillRect(8, -30, 12, 10);

    this._bossContainer.add(this._bossRect);

    // "BOSS" label above the rectangle
    this._bossLabel = this.add.text(BOSS_X, BOSS_Y - BOSS_H / 2 - 18, 'BOSS', {
      fontSize: '13px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ef4444',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(7);

    // Hurt flash overlay (invisible by default)
    this._hurtFlash = this.add.graphics().setDepth(8).setAlpha(0);
    this._hurtFlash.fillStyle(0xff3300, 0.7);
    this._hurtFlash.fillRect(BOSS_X - BOSS_W / 2, BOSS_Y - BOSS_H / 2, BOSS_W, BOSS_H);

    // Start idle pulse animation
    this._bossIdle();
  }

  // ── Player slots (left column) ───────────────────────────────────────────────
  _buildPlayerSlots() {
    this._playerSlots = [];
    for (let i = 0; i < 5; i++) {
      const x = PLAYER_X;
      const y = PLAYER_Y_LIST[i];

      // Placeholder rectangle for each slot (hidden until populated)
      const placeholder = this.add.graphics().setDepth(4).setAlpha(0);
      placeholder.fillStyle(0x334466, 0.8);
      placeholder.fillRect(-20, -24, 40, 48);

      // Name label (hidden until populated)
      const nameText = this.add.text(x, y + 28, '', {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5, 0).setDepth(4).setVisible(false);

      this._playerSlots.push({
        x, y,
        placeholder,
        sprite: null,
        nameText,
        cls: null,
        sheetKey: null,
        active: false,
      });
    }
  }

  // ── Dotted lines from player column to boss ──────────────────────────────────
  _buildConnectorLines() {
    const g = this.add.graphics().setDepth(2);
    g.lineStyle(1, 0x334466, 0.3);
    for (let i = 0; i < 5; i++) {
      const py = PLAYER_Y_LIST[i];
      // Draw short dashes toward boss
      for (let dx = PLAYER_X + 30; dx < BOSS_X - BOSS_W / 2 - 10; dx += 14) {
        g.beginPath();
        g.moveTo(dx, py);
        g.lineTo(Math.min(dx + 8, BOSS_X - BOSS_W / 2 - 10), py);
        g.strokePath();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API — called by BossRaidScreen.jsx
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Called when BossRaidScreen mounts with initial raid data.
   * @param {object} opts
   * @param {string} opts.raidId
   * @param {string} opts.bossName
   * @param {number} opts.bossHp
   * @param {number} opts.bossMaxHp
   * @param {number} opts.bossPhase
   * @param {{class: string, sheetPath: string, username: string}} opts.myPlayer
   * @param {Array}  opts.recentAttackers
   */
  setRaidData(opts) {
    this._raidData = opts;
    if (this._sceneReady) {
      this._applyRaidData(opts);
    }
  }

  /**
   * Called every time boss_update socket event fires.
   * @param {object} data  — {current_hp, max_hp, phase, status, recent_attackers, attacker_id}
   */
  onBossUpdate(data) {
    if (!this._sceneReady) return;

    const prevPhase = this._bossPhase;

    if (typeof data.current_hp === 'number') this._bossHp = data.current_hp;
    if (typeof data.max_hp     === 'number') this._bossMaxHp = data.max_hp;
    if (typeof data.phase      === 'number') this._bossPhase = data.phase;
    if (typeof data.status     === 'string') this._bossStatus = data.status;

    // Refresh phase visuals if phase changed
    if (data.phase && data.phase !== prevPhase) {
      this._applyPhaseVisuals(data.phase);
    }

    // Flash hurt animation on every boss update (means someone hit the boss)
    this._bossHurt();

    // Refresh attacker sprites if provided
    if (Array.isArray(data.recent_attackers)) {
      this._refreshAttackers(data.recent_attackers);
    }

    // Trigger death animation if boss just died
    if (data.status === 'defeated' || (typeof data.current_hp === 'number' && data.current_hp <= 0)) {
      this._bossDeath();
    }
  }

  /**
   * Shows a floating damage number near the boss.
   * @param {number} damage
   */
  showDamageNumber(damage) {
    if (!this._sceneReady || damage == null) return;

    const isLarge = damage > 20;
    const color  = isLarge ? '#ef4444' : '#fbbf24';
    const size   = isLarge ? '22px' : '18px';

    // Random offset around boss center
    const ox = Phaser.Math.Between(-60, 60);
    const oy = Phaser.Math.Between(-40, 40);
    const startX = BOSS_X + ox;
    const startY = BOSS_Y - 20 + oy;

    const txt = this.add.text(startX, startY, `-${damage}`, {
      fontSize: size,
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(20);

    this.tweens.add({
      targets: txt,
      y: startY - 48,
      alpha: { from: 1, to: 0 },
      duration: 700,
      ease: 'Power2',
      onComplete: () => { if (txt.active) txt.destroy(); },
    });
  }

  /**
   * Called when raid_finished socket event fires.
   * @param {object} data — {status: 'defeated'|'expired'}
   */
  onRaidFinished(data) {
    if (!this._sceneReady) return;
    this._bossStatus = data?.status || 'defeated';
    if (this._bossStatus === 'defeated') {
      this._bossDeath();
    }
    // Dim all player sprites
    this._playerSlots.forEach((slot) => {
      if (slot.sprite?.active) {
        this.tweens.add({ targets: slot.sprite, alpha: 0.3, duration: 800 });
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  _applyRaidData(opts) {
    if (!opts) return;

    this._bossHp     = opts.bossHp    ?? this._bossHp;
    this._bossMaxHp  = opts.bossMaxHp ?? this._bossMaxHp;
    this._bossPhase  = opts.bossPhase ?? 1;

    // Update boss name label
    if (this._bossLabel && opts.bossName) {
      this._bossLabel.setText(opts.bossName.toUpperCase());
    }

    // Apply phase visuals
    this._applyPhaseVisuals(this._bossPhase);

    // Build player slots — myPlayer in slot 0, recentAttackers in slots 1–4
    const attackers = Array.isArray(opts.recentAttackers) ? opts.recentAttackers : [];
    const players   = [opts.myPlayer, ...attackers].filter(Boolean).slice(0, 5);
    players.forEach((p, i) => this._populatePlayerSlot(i, p));
  }

  _populatePlayerSlot(index, playerData) {
    if (index >= this._playerSlots.length || !playerData) return;
    const slot = this._playerSlots[index];
    slot.active = true;

    const cls       = String(playerData.class_name || playerData.class || playerData.character_class || 'warrior').toLowerCase();
    const sheetPath = playerData.sheetPath || playerData.character_spritesheet_path || null;
    const username  = playerData.username || playerData.first_name || `P${index + 1}`;
    slot.cls = cls;

    // Show name label
    slot.nameText.setText(username.slice(0, 8));
    slot.nameText.setVisible(true);

    if (sheetPath && sheetPath.startsWith('/generated/')) {
      this._loadGeneratedSheet(slot, index, cls, sheetPath);
    } else {
      this._spawnFallbackRect(slot, index, cls);
    }
  }

  _loadGeneratedSheet(slot, index, cls, sheetPath) {
    const url      = resolveSheetUrl(sheetPath);
    if (!url) { this._spawnFallbackRect(slot, index, cls); return; }

    const safeKey = `boss_player_${sheetPath.replace(/[^A-Za-z0-9]/g, '_')}`;
    slot.sheetKey = safeKey;

    const afterLoad = () => {
      if (!this.textures.exists(safeKey)) {
        this._spawnFallbackRect(slot, index, cls);
        return;
      }
      this._registerSlotAnimations(safeKey, safeKey);
      this._spawnLpcSprite(slot, index, safeKey, GENERATED_FRAME_SIZE, 13);
    };

    if (this.textures.exists(safeKey)) {
      afterLoad();
      return;
    }
    if (this._dynamicLoads.has(safeKey)) return;
    this._dynamicLoads.add(safeKey);
    this.load.spritesheet(safeKey, url, {
      frameWidth:  GENERATED_FRAME_SIZE,
      frameHeight: GENERATED_FRAME_SIZE,
    });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this._dynamicLoads.delete(safeKey);
      afterLoad();
    });
    if (!this.load.isLoading()) this.load.start();
  }

  _registerSlotAnimations(textureKey, animPrefix) {
    const cols = 13; // generated sheets always 13 cols
    const F    = makeF(cols);
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
    const originY  = frameSize === GENERATED_FRAME_SIZE ? 0.75 : 1.0;

    // Remove previous sprite/rect if any
    if (slot.sprite?.active) slot.sprite.destroy();
    if (slot.placeholder) slot.placeholder.setAlpha(0);

    const sprite = this.add.sprite(x, y, textureKey)
      .setOrigin(0.5, originY)
      .setScale(PLAYER_SCALE)
      .setDepth(4)
      .setFlipX(true); // face right toward boss

    slot.sprite = sprite;

    // Play attack loop
    const attackKey = `${textureKey}_attack`;
    if (this.anims.exists(attackKey)) {
      sprite.play(attackKey);
    } else {
      const idleKey = `${textureKey}_idle`;
      if (this.anims.exists(idleKey)) sprite.play(idleKey);
    }

    // Subtle horizontal oscillation toward boss
    this._addAttackOscillation(sprite, index);
  }

  _spawnFallbackRect(slot, index, cls) {
    const { x, y } = slot;

    if (slot.sprite?.active) slot.sprite.destroy();

    const g = this.add.graphics().setDepth(4);
    const color = CLASS_COLORS[cls] ?? 0x888888;
    g.fillStyle(color, 0.85);
    g.fillRect(x - 14, y - 30, 28, 40);
    g.lineStyle(1, 0xffffff, 0.25);
    g.strokeRect(x - 14, y - 30, 28, 40);

    // Class initial letter
    const letter = this.add.text(x, y - 10, cls[0].toUpperCase(), {
      fontSize: '14px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5).setDepth(5);

    // Wrap in container for oscillation tween
    const container = this.add.container(0, 0, [g, letter]).setDepth(4);
    slot.sprite = container;
    this._addAttackOscillation(container, index);
  }

  _addAttackOscillation(target, index) {
    // Stagger the oscillation so all 5 sprites don't move in sync
    const delay = index * 160;
    this.tweens.add({
      targets: target,
      x: `+=${8}`,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay,
    });
  }

  // ── Boss animations ──────────────────────────────────────────────────────────

  /**
   * Idle pulse tween: scale oscillates between 0.97 and 1.03 over 1200ms.
   */
  _bossIdle() {
    if (this._bossPulseTween) {
      this._bossPulseTween.stop();
      this._bossPulseTween = null;
    }
    if (!this._bossContainer?.active) return;
    this._bossPulseTween = this.tweens.add({
      targets:  this._bossContainer,
      scaleX:   { from: 0.97, to: 1.03 },
      scaleY:   { from: 0.97, to: 1.03 },
      duration: 1200,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });
  }

  /**
   * Hurt flash: brief red tint overlay for 150ms using a flash rectangle.
   */
  _bossHurt() {
    if (!this._hurtFlash?.active) return;
    // Stop any existing hurt tween
    this.tweens.killTweensOf(this._hurtFlash);
    this._hurtFlash.setAlpha(0.7);
    this.tweens.add({
      targets:  this._hurtFlash,
      alpha:    0,
      duration: 150,
      ease:     'Power2',
    });

    // Also do a brief camera shake if available
    if (this.cameras?.main) {
      this.cameras.main.shake(60, 0.004);
    }
  }

  /**
   * Death animation: scale the container to 0 + optional particles.
   */
  _bossDeath() {
    if (!this._bossContainer?.active) return;

    // Stop idle pulse
    if (this._bossPulseTween) {
      this._bossPulseTween.stop();
      this._bossPulseTween = null;
    }

    // Scale to zero
    this.tweens.add({
      targets:  this._bossContainer,
      scaleX:   0,
      scaleY:   0,
      duration: 600,
      ease:     'Back.easeIn',
      onComplete: () => {
        if (this._bossContainer?.active) this._bossContainer.setVisible(false);
        if (this._bossLabel?.active)     this._bossLabel.setVisible(false);
      },
    });

    // Fade out the label too
    if (this._bossLabel?.active) {
      this.tweens.add({
        targets: this._bossLabel, alpha: 0, duration: 400, ease: 'Power2',
      });
    }

    // Spawn burst particles using graphics dots
    this._spawnDeathParticles();
  }

  _spawnDeathParticles() {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const angle  = (i / count) * Math.PI * 2;
      const speed  = Phaser.Math.Between(40, 100);
      const size   = Phaser.Math.Between(3, 8);
      const colors = [0xef4444, 0xff6600, 0xfbbf24, 0x8b0000];
      const color  = Phaser.Utils.Array.GetRandom(colors);

      const g = this.add.graphics().setDepth(10);
      g.fillStyle(color, 1);
      g.fillRect(-size / 2, -size / 2, size, size);
      g.x = BOSS_X;
      g.y = BOSS_Y;

      this.tweens.add({
        targets:  g,
        x:        BOSS_X + Math.cos(angle) * speed,
        y:        BOSS_Y + Math.sin(angle) * speed,
        alpha:    0,
        duration: 700,
        ease:     'Power2',
        delay:    Phaser.Math.Between(0, 120),
        onComplete: () => { if (g.active) g.destroy(); },
      });
    }
  }

  // ── Phase visuals ────────────────────────────────────────────────────────────
  _applyPhaseVisuals(phase) {
    if (!this._bossContainer?.active) return;

    // Phase 1 → normal dark red placeholder (no overlay)
    // Phase 2 → add orange tint overlay
    // Phase 3 → add red glow + faster pulse tween

    if (this._phaseOverlay?.active) {
      this._phaseOverlay.clear();
    }

    if (phase === 2) {
      // Orange overlay
      if (this._phaseOverlay?.active) {
        this._phaseOverlay.fillStyle(0xff6600, 0.18);
        this._phaseOverlay.fillRect(BOSS_X - BOSS_W / 2, BOSS_Y - BOSS_H / 2, BOSS_W, BOSS_H);
      }
    } else if (phase >= 3) {
      // Red glow overlay
      if (this._phaseOverlay?.active) {
        this._phaseOverlay.fillStyle(0xff0000, 0.25);
        this._phaseOverlay.fillRect(BOSS_X - BOSS_W / 2, BOSS_Y - BOSS_H / 2, BOSS_W, BOSS_H);
      }
      // Restart idle pulse with faster speed
      if (this._bossPulseTween) {
        this._bossPulseTween.stop();
        this._bossPulseTween = null;
      }
      if (this._bossContainer?.active) {
        this._bossPulseTween = this.tweens.add({
          targets:  this._bossContainer,
          scaleX:   { from: 0.94, to: 1.06 },
          scaleY:   { from: 0.94, to: 1.06 },
          duration: 500,   // faster than phase 1's 1200ms
          yoyo:     true,
          repeat:   -1,
          ease:     'Sine.easeInOut',
        });
      }
    } else {
      // Phase 1 — use normal idle pulse
      this._bossIdle();
    }
  }

  // ── Refresh attacker sprites from recent_attackers array ─────────────────────
  _refreshAttackers(attackers) {
    // Only refresh slots 1–4 (slot 0 is always myPlayer)
    const list = attackers.slice(0, 4);
    list.forEach((attacker, i) => {
      const slotIndex = i + 1;
      if (slotIndex >= this._playerSlots.length) return;
      const slot = this._playerSlots[slotIndex];
      // Only repopulate if this is a new user (avoid re-loading same texture)
      const newCls  = String(attacker.class_name || attacker.class || attacker.character_class || 'warrior').toLowerCase();
      const newPath = attacker.sheetPath || attacker.character_spritesheet_path || null;
      const prevKey = slot.sheetKey || '';
      const newKey  = newPath
        ? `boss_player_${newPath.replace(/[^A-Za-z0-9]/g, '_')}`
        : `fb_${newCls}`;
      if (slot.active && prevKey === newKey) return; // already correct sprite
      this._populatePlayerSlot(slotIndex, attacker);
    });
  }
}
