import Phaser from 'phaser';

// Shared combat sprite/animation contracts — single source of truth (Phase 7)
import {
  W, H, FLOOR_Y, SPRITE_SCALE, SPRITE_HEIGHT, FOOT_OFFSET,
  CLASS_COLS, makeF, ANIM_ROW_DEFS,
  CLASS_COLORS, CLASS_HEX,
  WEAPON_SHEET_COLS, WEAPON_ANIM_ROWS, HELD_WEAPON_POSE,
} from '../combatSprites';
// Shared movement/jump tuning — same feel as Arena (single source of truth)
import { MOVE_SPEED_PX_S, JUMP_HEIGHT_PX, JUMP_RISE_MS, JUMP_EASE, JUMP_COOLDOWN_MS } from '../combatTuning';
// Shared skill VFX — identical animations to Arena (single source of truth)
import { showGuardBreak, showBash, showFireball, showBlink } from '../combatEffects';

// ── Enchant FX ────────────────────────────────────────────────────────────────
const ENCHANT_FX = [
  null,
  { color: 0x99ccff, strength: 1.5, pulse: false },
  { color: 0x55aaff, strength: 2.0, pulse: false },
  { color: 0x2277ff, strength: 2.5, pulse: false },
  { color: 0x0044dd, strength: 3.0, pulse: false },
  { color: 0x002299, strength: 3.5, pulse: false },
  { color: 0x8800ff, strength: 4.0, pulse: false },
  { color: 0xcc00ee, strength: 4.5, pulse: false },
  { color: 0xffaa00, strength: 4.5, pulse: true, dur: 800 },
  { color: 0xff6600, strength: 5.0, pulse: true, dur: 500 },
  { color: 0xff2200, strength: 5.5, pulse: true, dur: 380, trail: true },
];

function applyEnchantFX(scene, weapon, enchant, spawnX, visualY) {
  if (!weapon?.active || !weapon.preFX) return null;
  weapon.preFX.clear();
  const fx = ENCHANT_FX[Math.min(enchant, 10)];
  if (!fx) return null;
  const startStr = fx.pulse ? fx.strength * 0.45 : fx.strength;
  const glowFX   = weapon.preFX.addGlow(fx.color, startStr, 0);
  if (fx.pulse) {
    scene.tweens.add({ targets: glowFX, outerStrength: { from: startStr, to: fx.strength }, yoyo: true, repeat: -1, duration: fx.dur });
  }
  let trail = null;
  if (fx.trail && scene.textures.exists('smoke_particle')) {
    trail = scene.add.particles(spawnX, visualY, 'smoke_particle', {
      speed: { min: 8, max: 24 }, scale: { start: 0.22, end: 0 },
      alpha: { start: 0.35, end: 0 }, lifespan: 400, quantity: 1,
      tint: 0xff2200, emitting: true,
    });
    trail.setDepth(3);
  }
  return trail;
}

function cubicBezierPoints(x0, y0, x1, y1, x2, y2, x3, y3, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t  = i / steps;
    const mt = 1 - t;
    pts.push({
      x: mt*mt*mt*x0 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3,
      y: mt*mt*mt*y0 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3,
    });
  }
  return pts;
}

function spawnWhoosh(scene, x, y, facingRight) {
  const g = scene.add.graphics().setDepth(5);
  const d = facingRight ? 1 : -1;
  const p1 = cubicBezierPoints(x+d*8, y-28, x+d*34, y-52, x+d*56, y-18, x+d*42, y+14, 10);
  const p2 = cubicBezierPoints(x+d*4, y-22, x+d*26, y-44, x+d*48, y-12, x+d*36, y+16, 10);
  g.lineStyle(2.5, 0xffffff, 0.9);
  g.strokePoints(p1, false);
  g.lineStyle(1.5, 0xaaddff, 0.6);
  g.strokePoints(p2, false);
  scene.tweens.add({ targets: g, alpha: 0, duration: 200, ease: 'Power2', onComplete: () => { if (g.active) g.destroy(); } });
}

const CROWD_COLORS = [0xc0392b, 0x8e44ad, 0x2980b9, 0x27ae60, 0xe67e22, 0xf39c12, 0x1abc9c, 0xe91e63, 0xffffff, 0xbdc3c7];

// ── Boss constants ────────────────────────────────────────────────────────────
const BOSS_SHEET = '/characters/boss/wartotaur.png';
const BOSS_FRAME = 128;
const BOSS_COLS  = 7;
const BOSS_SCALE = 2.8;
const BF         = (row, col) => row * BOSS_COLS + col;

const BOSS_ANIM_DEFS = {
  idle:   { frames: [BF(0,0), BF(0,1), BF(0,2), BF(0,3)],          rate: 5,  loop: -1 },
  attack: { frames: [BF(3,0), BF(3,1), BF(3,2), BF(3,3), BF(3,4)], rate: 10, loop: 0  },
  death:  { frames: [BF(6,0), BF(6,1), BF(6,2), BF(6,3), BF(6,4)], rate: 7,  loop: 0  },
};

const BOSS_X         = 610;
const BOSS_Y         = FLOOR_Y;
const PLAYER_START_X = 90;
const PLAYER_STOP_X  = 470; // kiek dešinėn galima nueiti — arčiau boso (BOSS_X=610)
const PLAYER_SPEED   = MOVE_SPEED_PX_S; // px/sec — bendras su Arena (combatTuning)

const ATTACKER_SLOTS_X = [140, 210, 290, 370, 450];

// Generuoti charakteriai saugomi backend'e (/generated/...). Grąžiname RELATYVŲ kelią —
// dev'e jį per proxy (:3000 → :8001) persiunčia same-origin, prod'e jis same-origin pats.
// (Taip daro ir Arena BattleScene. Pridėjus ${BACKEND_URL} būtų cross-origin → CORS fail → fallback.)
function resolveSheetUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phaser.Scene yra bazinė klasė. Mūsų scena ją praplečia (extends).
// Phaser automatiškai kviečia preload() → create() → update() kas kadrą.
export default class BossRaidScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BossRaidScene' }); // 'key' = unikalus scenos vardas Phaser viduje

    // --- Boss duomenys iš serverio ---
    // Šie laukai atnaujinami kai ateina WebSocket žinutė (onBossUpdate)
    this._raidData        = null;  // laikinas buferis kol scena dar nekurta
    this._myUserId        = null;
    this._bossPhase       = 1;     // 1/2/3 — kuo didesnis, tuo greičiau atakuoja
    this._bossHp          = 1;
    this._bossMaxHp       = 1;
    this._bossStatus      = 'active';

    // --- Boss Phaser objektai (sukuriami create() metu) ---
    this._bossSprite      = null;
    this._bossLabel       = null;
    this._hurtFlash       = null;  // raudonas flash kai bosui daromas damage
    this._bossPulseTween  = null;  // pulsavimo animacija idle metu
    this._bossDeadPlayed  = false; // guard — mirties animacija leidžiama tik vieną kartą
    this._bossAttackTimer = null;
    this._bossIsAttacking = false;

    // --- Mano žaidėjo būsena (viskas čia, ne React state) ---
    // Phaser veikia atskirai nuo React — duomenys laikomi scene viduje, ne useState
    this._myPlayer        = null;  // objektas su body, weapon, hpBar ir kt.
    this._myPlayerX       = PLAYER_START_X; // X pozicija pikseliais
    this._mySpeed         = MOVE_SPEED_PX_S; // px/s — pakeičiamas pagal klasę iš serverio (setMyVitals)
    this._myPlayerState   = 'idle';          // 'idle' | 'walk' | 'attacking' | 'dead'
    this._attackGen       = 0;               // didinama kiekvienos atakos — kad senas backstop nenutrauktų naujos
    this._myPlayerFacing  = 1;               // 1 = dešinėn, -1 = kairėn
    this._joystickLeft    = false;           // joystick input iš React komponento
    this._joystickRight   = false;
    this._jumpOffsetY     = 0;     // šuolio aukštis pikseliais (tweenuojamas 0→60→0)
    this._isJumping       = false; // guard — neleidžia dvigubo šuolio
    this._myBlocking      = false; // ar laikomas block mygtukas (rodo skydą)
    this._myBlockFx       = null;  // skydo grafika
    this._myBlockTween    = null;  // skydo pulsavimo tween
    this._downed          = false; // Group A: ar nokautuotas (serverio hp<=0) — negali veikti

    // --- Kiti žaidėjai (5 slots ekrano centre) ---
    this._attackerSlots   = [];
    this._dynamicLoads    = new Set(); // seka kurie spritesheet'ai jau kraunami (neleidžia dvigubo load)
    this._sceneReady      = false;     // false kol create() nebaigtas — neleidžia rašyti į scenos objektus

    // --- Phase 4: live žaidėjai iš Colyseus (serveris laiko action state) ---
    this._liveMode        = false;          // true kai bent vienas live žaidėjas atėjo per Colyseus
    this._sessionSlots    = new Map();      // sessionId → slot index
    this._serverDrivenBoss = false;         // true kai serveris pradeda valdyti boso atakas

    // --- Phase 5: movement (mano poziciją siunčiu serveriui; kitus interpoliuoju) ---
    this._moveSendCb      = null;           // React callback: ({x, facingRight}) => room.send('move', ...)
    this._lastSentX       = null;           // paskutinė serveriui nusiųsta x
    this._lastSentFacing  = null;           // paskutinė nusiųsta kryptis
    this._lastMoveSentAt  = 0;              // throttle laikas (ms)

    this.hitEmitter       = null;  // dalelių sistema (kibirkštys kai smūgiuojama)
    this.spectators       = [];
    this.torchTweens      = [];
  }

  // ── Preload ───────────────────────────────────────────────────────────────
  // PIRMAS iš trijų Phaser lifecycle metodų.
  // Čia tik registruojame ką reikia atsisiųsti — Phaser pats atlieka download'ą.
  // create() bus kviečiamas tik kai VISI šie failai bus pilnai užkrauti.
  preload() {
    this._isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 600;
    this.load.on('loaderror', (file) => console.warn('[BossRaidScene] missing:', file.key));

    // frameWidth/frameHeight = vieno kadro dydis PNG faile
    this.load.spritesheet('wartotaur', BOSS_SHEET, { frameWidth: BOSS_FRAME, frameHeight: BOSS_FRAME });

    // Fallback spritesheet'ai jei žaidėjas neturi generuoto charakterio
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      this.load.spritesheet(`cls_${cls}`, `/characters/${cls}_sheet.png`, { frameWidth: 64, frameHeight: 64 });
    });

    // WebGL context gali būti prarastas kai telefonas užminga — priverčiame reload'ą
    this.game.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      setTimeout(() => window.location.reload(), 1500);
    });
  }

  // ── Create ────────────────────────────────────────────────────────────────
  // ANTRAS lifecycle metodas — kviečiamas vieną kartą kai visi assets užkrauti.
  // Čia statome visą sceną: fonas, animacijos, sprites, particle sistemos.
  create() {
    try {
      this._createParticleTextures();
      this._buildArena();
      if (!this._isMobile) this._buildFloorFog();
      this._registerBossAnimations();
      this._registerAllClassAnimations();
      this._buildBoss();
      this._buildAttackerSlots();
      this._sceneReady = true; // tik dabar leidžiame React'ui rašyti į sceną
      // Jei React jau atsiuntė duomenis kol scena kūrėsi — pritaikome juos dabar
      if (this._raidData) this._applyRaidData(this._raidData);
      this._startBossAttackLoop();
    } catch (err) {
      console.error('[BossRaidScene] create() failed:', err);
      this._sceneReady = true;
      this.add.text(W / 2, H / 2, `Scene error\n${err?.message || ''}`, {
        fontSize: '13px', fontFamily: 'monospace', color: '#ef4444',
        align: 'center', backgroundColor: 'rgba(0,0,0,0.8)', padding: { x: 10, y: 8 },
      }).setOrigin(0.5).setDepth(100);
    }
  }

  // ── Update loop ───────────────────────────────────────────────────────────
  // TREČIAS lifecycle metodas — kviečiamas ~60 kartų per sekundę (kiekvieną kadrą).
  // Čia judinama pozicija, tikrinama input. NIEKADA nekurti objektų čia — tik atnaujinti.
  // delta = ms praėję nuo paskutinio kadro. Naudojame dt (sekundėmis) kad greitis
  // būtų vienodas nepriklausomai nuo FPS (120fps vs 30fps judėjimas tas pats).
  update(time, delta) {
    if (!this._sceneReady) return;
    const dt = delta / 1000; // paverčiame į sekundes: PLAYER_SPEED * dt = px/sec

    // Kitų žaidėjų pozicijų interpoliacija — kas kadrą, nepriklausomai nuo mano būsenos
    this._updateLivePlayers(dt);

    if (!this._myPlayer?.body?.active) return;
    if (this._myPlayerState === 'dead' || this._downed) return; // nokautuotas — negali judėti

    const attacking = this._myPlayerState === 'attacking';
    let moving = false;

    // Judėjimas tik kai NEatakuojam (bet poziciją sinchronizuojam visada — žr. žemiau)
    if (!attacking) {
      if (this._joystickLeft && this._myPlayerX > 30) {
        this._myPlayerX -= (this._mySpeed || PLAYER_SPEED) * dt;
        this._myPlayerFacing = -1;
        moving = true;
      } else if (this._joystickRight && this._myPlayerX < PLAYER_STOP_X) {
        this._myPlayerX += (this._mySpeed || PLAYER_SPEED) * dt;
        this._myPlayerFacing = 1;
        moving = true;
      }
    }

    const p = this._myPlayer;

    // Math.sin grąžina -1..1 pagal laiką — sukuria sklandų svyravimą aukštyn-žemyn
    if (p.cls === 'mage' && !p.deathPlayed && !moving && this._myPlayerState === 'idle') {
      const floatY = Math.sin(time * 0.0025) * 5;
      const vy = FLOOR_Y + FOOT_OFFSET + floatY;
      p.body.setY(vy);
      if (p.weapon?.active) this._syncHeldWeaponPos(p, this._myPlayerX, vy);
      if (p.aura?.active)   p.aura.setY(vy - SPRITE_HEIGHT / 2);
    }

    // VISADA perkelia žaidėjo objektus į teisingą X/Y — net attacking metu, kad jump'o
    // offset'as atsistatytų ir char neužšaltų ore. Anim keitimas _syncMyPlayerVisuals
    // viduje guard'intas (nekeičia anim attacking/jumping metu).
    this._syncMyPlayerVisuals(moving);
    this._syncMyBlockGuard(); // skydas seka žaidėją (jei laikomas block)

    // Phase 5: praneš serveriui mano poziciją tik kai nejudam per attack
    if (!attacking) this._maybeSendMove();
  }

  // Throttle'inamai siunčia mano x/kryptį serveriui kai jos pasikeičia.
  _maybeSendMove() {
    if (!this._moveSendCb) return;
    const facingRight = this._myPlayerFacing >= 0;
    const xChanged    = this._lastSentX == null || Math.abs(this._myPlayerX - this._lastSentX) > 1;
    const faceChanged = this._lastSentFacing !== facingRight;
    if (!xChanged && !faceChanged) return;
    const now = this.time.now;
    if (now - this._lastMoveSentAt < 90) return; // ~11 žinučių/sek riba
    this._lastMoveSentAt = now;
    this._lastSentX      = this._myPlayerX;
    this._lastSentFacing = facingRight;
    this._moveSendCb({ x: Math.round(this._myPlayerX), facingRight });
  }

  // Kiekvieną kadrą glotniai stumia kitų žaidėjų sprite'us link serverio x pozicijos
  // ir parenka walk/idle animaciją pagal judėjimą (jei jų action state = idle).
  _updateLivePlayers(dt) {
    if (!this._liveMode) return;
    const lerp = Math.min(1, dt * 10); // glotninimo koeficientas
    this._attackerSlots.forEach((slot) => {
      if (!slot.active || slot.sessionId == null || !slot.sprite?.active) return;
      if (slot.targetX == null) return;
      // Tik tikri sprite'ai juda/animuojasi — rect fallback (container) lieka slot.x
      const isSprite = typeof slot.sprite.setFlipX === 'function' && typeof slot.sprite.play === 'function';
      if (!isSprite) return;
      if (slot.curX == null) slot.curX = slot.targetX;
      slot.curX += (slot.targetX - slot.curX) * lerp;
      const moving = Math.abs(slot.targetX - slot.curX) > 1.2;

      slot.sprite.x = slot.curX;
      slot.sprite.setFlipX(!slot.facingRight);
      if (slot.nameText?.active) slot.nameText.x = slot.curX;

      // idle ↔ walk tik kai serverio action state yra idle (neperrašom attack/hit/dead)
      if (slot.lpcState === 'idle' && slot.sheetKey) {
        const want = moving ? 'walk' : 'idle';
        if (slot.moveAnim !== want) {
          const k  = `${slot.sheetKey}_${want}`;
          const fk = `${slot.sheetKey}_idle`;
          if (this.anims.exists(k)) slot.sprite.play(k, true);
          else if (this.anims.exists(fk)) slot.sprite.play(fk, true);
          slot.moveAnim = want;
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  // React komponento (BossRaidScreen.jsx) iškvietimai į sceną — PUBLIC API
  // React ir Phaser gyvena atskiruose "pasauliuose": React tvarko UI, Phaser tvarko canvas.
  // Šie metodai yra tiltas tarp jų.

  // Kviečiamas kai React gauna duomenis iš serverio ir nori perduoti scenai.
  // Jei scena dar nekurta — duomenys laikomi _raidData ir pritaikomi create() pabaigoje.
  setRaidData(opts) {
    this._raidData = opts;
    if (this._sceneReady) this._applyRaidData(opts);
  }

  // Phase 5: React registruoja callback'ą kuriuo scena siunčia mano poziciją serveriui.
  setMoveCallback(cb) {
    this._moveSendCb = cb;
  }

  onBossUpdate(data) {
    if (!this._sceneReady) return;
    const prevPhase = this._bossPhase;
    if (typeof data.current_hp === 'number') this._bossHp    = data.current_hp;
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
    const isBig  = damage >= 20;
    const color  = isBig ? '#ff2200' : '#ef4444';
    const size   = isBig ? '28px'    : '20px';
    const startX = BOSS_X + Phaser.Math.Between(-80, 80);
    const startY = BOSS_Y - 120 + Phaser.Math.Between(-30, 30);
    const txt = this.add.text(startX, startY, `-${damage}`, {
      fontSize: size, fontFamily: 'monospace', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: isBig ? 5 : 3,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: txt, y: startY - 65, alpha: 0,
      scaleX: isBig ? 1.4 : 1, scaleY: isBig ? 1.4 : 1,
      duration: 850, ease: 'Power1',
      onComplete: () => { if (txt.active) txt.destroy(); },
    });
    if (this.hitEmitter?.active) {
      this.hitEmitter.explode(isBig ? 14 : 8, startX, startY);
    }
    if (isBig && this.cameras?.main) this.cameras.main.shake(160, 0.006);
  }

  onRaidFinished(data) {
    if (!this._sceneReady) return;
    this._bossStatus = data?.status || 'defeated';
    if (this._bossStatus === 'defeated') this._bossDeath();
    this._attackerSlots.forEach((slot) => {
      if (slot.sprite?.active) this.tweens.add({ targets: slot.sprite, alpha: 0.3, duration: 800 });
    });
    if (this._myPlayer?.body?.active && this._myPlayer.animPrefix) {
      const hk = `${this._myPlayer.animPrefix}_hurt`;
      if (this.anims.exists(hk)) this._myPlayer.body.play(hk);
    }
  }

  setJoystickInput({ left, right }) {
    this._joystickLeft  = !!left;
    this._joystickRight = !!right;
  }

  // Block mygtukas — rodo/slepia skydą (gina nuo boso atakos, serveris skaičiuoja žalą)
  setBlock(down) {
    if (this._downed) { this._myBlocking = false; return; }
    this._myBlocking = !!down;
  }

  // Group A: mano HP + downed būsena iš serverio. Atnaujina HP bar'ą ir nokauto vizualą.
  setMyVitals({ hp, maxHp, state, moveSpeed } = {}) {
    if (!this._sceneReady || !this._myPlayer) return;
    const p = this._myPlayer;

    // Greitis pagal klasę (iš serverio / battle_classes.json)
    if (typeof moveSpeed === 'number' && moveSpeed > 0) this._mySpeed = moveSpeed;

    // HP bar (origin 0 → trumpėja iš dešinės). displayWidth/setFillStyle, nes
    // tiesioginis .width/.fillColor Phaser Rectangle'e neperpiešia.
    if (p.hpBar?.active && typeof hp === 'number' && maxHp > 0) {
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      p.hpBar.displayWidth = 56 * pct;
      p.hpBar.setFillStyle(pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444);
    }

    const downed = state === 'downed';
    if (downed && !this._downed) {
      this._downed = true;
      this._myBlocking = false;
      if (p.body?.active && p.animPrefix) {
        const dk = `${p.animPrefix}_dead`;
        if (this.anims.exists(dk)) p.body.play(dk, true);
        if (p.body.setTint) p.body.setTint(0x888888); // pilkas = nokautuotas
      }
    } else if (!downed && this._downed) {
      this._downed = false;
      this._myPlayerState = 'idle';
      if (p.body?.active) {
        if (p.body.clearTint) p.body.clearTint();
        const ik = `${p.animPrefix}_idle`;
        if (p.animPrefix && this.anims.exists(ik)) p.body.play(ik, true);
      }
    }
  }

  // Knockback — kai bosas pataiko be block'o, lokaliai stumiame žaidėją ATGAL nuo boso.
  // Bosas dešinėj (BOSS_X), tad stumiame KAIRĖN. Movement čia client-authoritative, todėl
  // pakanka pakeisti _myPlayerX — update() per-frame sync nusiųs naują poziciją serveriui.
  knockbackMyPlayer(px = 40) {
    if (this._downed) return;
    this._myPlayerX = Math.max(30, this._myPlayerX - px);
    // Subtilus "hurt" camera shake — tik jei kamera egzistuoja
    if (this.cameras?.main) this.cameras.main.shake(120, 0.004);
  }

  // Piešia/atnaujina mano žaidėjo skydą kas kadrą (portas iš Arena _syncBlockGuard)
  _syncMyBlockGuard() {
    const p = this._myPlayer;
    const blocking = this._myBlocking && p?.body?.active && this._myPlayerState !== 'dead';
    if (!blocking) {
      if (this._myBlockFx?.active) this._myBlockFx.setVisible(false);
      return;
    }
    if (!this._myBlockFx?.active) {
      this._myBlockFx = this.add.graphics().setDepth(3);
      this._myBlockTween = this.tweens.add({
        targets: this._myBlockFx, alpha: { from: 0.62, to: 1 },
        yoyo: true, repeat: -1, duration: 520, ease: 'Sine.easeInOut',
      });
    }
    const visualY = (FLOOR_Y + FOOT_OFFSET) - this._jumpOffsetY;
    const topY    = visualY - SPRITE_HEIGHT;
    const x       = this._myPlayerX;
    const xMul    = this._myPlayerFacing >= 0 ? 1 : -1;
    const shieldX = x + xMul * 31;
    const shieldY = Math.max(topY + 46, visualY - 62);
    const g = this._myBlockFx;
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

  triggerPlayerAttack() {
    if (!this._sceneReady || !this._myPlayer?.body?.active) return;
    if (this._myPlayerState === 'attacking' || this._myPlayerState === 'dead' || this._downed) return;

    this._myPlayerState  = 'attacking';
    this._myPlayerFacing = 1;
    if (this._myPlayer.body.setFlipX) this._myPlayer.body.setFlipX(false);

    if (this._myPlayer.weapon?.active) this._swingHeldWeapon(this._myPlayer);

    const wY = (FLOOR_Y + FOOT_OFFSET) - SPRITE_HEIGHT * 0.55;
    spawnWhoosh(this, this._myPlayerX, wY, true);

    const p        = this._myPlayer;
    const attackKey = `${p.animPrefix}_attack`;
    const idleKey   = `${p.animPrefix}_idle`;

    if (p.animPrefix && this.anims.exists(attackKey) && p.body.play) {
      const gen = ++this._attackGen;
      p.body.play(attackKey, true);
      const finish = () => {
        // gen tikrina kad nereaguotume į SENĄ ataką (kitaip stale backstop nutrauktų naują)
        if (this._myPlayerState !== 'attacking' || this._attackGen !== gen) return;
        this._myPlayerState = 'idle';
        if (p.body?.active && this.anims.exists(idleKey)) p.body.play(idleKey, true);
        if (p.weapon?.active) {
          const wk = `${p.cls}_weapon_idle`;
          if (this.anims.exists(wk)) p.weapon.play?.(wk, true);
        }
      };
      p.body.once('animationcomplete', finish);
      // Backstop — jei animationcomplete nutraukiamas (pvz. jump paleidžia idle), vis tiek atsistatom
      this.time.delayedCall(700, finish);
    } else {
      this.time.delayedCall(400, () => { if (this._myPlayerState === 'attacking') this._myPlayerState = 'idle'; });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JUMP  (joystick up)
  // ─────────────────────────────────────────────────────────────────────────

  triggerJump() {
    if (!this._sceneReady || !this._myPlayer?.body?.active) return;
    if (this._myPlayerState === 'attacking' || this._myPlayerState === 'dead' || this._downed) return;
    if (this._isJumping) return; // blokuoja dvigubą šuolį ore
    // Jump cooldown — bendras su Arena (combatTuning), kad jaustųsi vienodai
    const now = this.time.now;
    if (now - (this._lastJumpAt || 0) < JUMP_COOLDOWN_MS) return;
    this._lastJumpAt = now;

    const p       = this._myPlayer;
    const jumpKey = `${p.animPrefix}_jump`;
    const idleKey = `${p.animPrefix}_idle`;

    this._isJumping = true;
    if (p.animPrefix && this.anims.exists(jumpKey) && p.body.play) p.body.play(jumpKey, true);

    // Tweeniname plain objektą (ne 'this') — Phaser garantuotai interpoliuoja bet kurį
    // plain JS objekto lauką. onUpdate kas kadrą sinchronizuoja reikšmę su _jumpOffsetY.
    // yoyo:true = 0→HEIGHT→0; Quad.easeOut imituoja gravitacijos parabolę (kaip Arena fizika).
    const j = { v: 0 };
    this.tweens.add({
      targets: j, v: JUMP_HEIGHT_PX,
      duration: JUMP_RISE_MS, ease: JUMP_EASE, yoyo: true,
      onUpdate:   () => { this._jumpOffsetY = j.v; },
      onComplete: () => {
        this._jumpOffsetY = 0;
        this._isJumping   = false;
        if (!p.body?.active) return;
        // NEnutraukiam attack/cast animacijos jei žaidėjas atakavo ore — kitaip jos
        // animationcomplete neįvyktų ir būsena užstrigtų 'attacking' (char užšaltų).
        if (this._myPlayerState !== 'attacking' && p.animPrefix && this.anims.exists(idleKey) && p.body.play) {
          p.body.play(idleKey, true);
        }
        const baseY = FLOOR_Y + FOOT_OFFSET;
        // Nusileidimo dulkės — explode() iššauna N dalelių iš karto (ne loop)
        if (this.hitEmitter?.active) {
          this.hitEmitter.explode(8, this._myPlayerX - 14, baseY);
          this.hitEmitter.explode(8, this._myPlayerX + 14, baseY);
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ABILITY EFFECTS (ported from BattleScene)
  // ─────────────────────────────────────────────────────────────────────────

  triggerAbility(cls, abilityKey = '') {
    if (!this._sceneReady || !this._myPlayer?.body?.active) return;
    if (this._myPlayerState === 'dead' || this._downed) return;
    const key = abilityKey || `${cls}_default`;

    // Žaidėjas vizualiai atlieka veiksmą leidžiant skill (kaip Arenoje) — anksčiau
    // boss raid'e char nieko nedarydavo, tik atsirasdavo efektas. Dabar groja attack/cast.
    const p = this._myPlayer;
    if (p.animPrefix && this._myPlayerState !== 'attacking'
        && this.anims.exists(`${p.animPrefix}_attack`) && p.body.play) {
      this._myPlayerState  = 'attacking';
      this._myPlayerFacing = 1;
      if (p.body.setFlipX) p.body.setFlipX(false);
      if (p.weapon?.active) this._swingHeldWeapon(p);
      const gen = ++this._attackGen;
      p.body.play(`${p.animPrefix}_attack`, true);
      const finish = () => {
        if (this._myPlayerState !== 'attacking' || this._attackGen !== gen) return;
        this._myPlayerState = 'idle';
        const ik = `${p.animPrefix}_idle`;
        if (p.body?.active && this.anims.exists(ik)) p.body.play(ik, true);
      };
      p.body.once('animationcomplete', finish);
      this.time.delayedCall(700, finish); // backstop — kad būsena niekada neužstrigtų
    }

    const x = this._myPlayerX;
    const y = FLOOR_Y + FOOT_OFFSET;
    if      (key === 'warrior_guardbreak') this._showGuardBreakEffect(x, y);
    else if (cls === 'warrior')            this._showBashEffect(x, y, key);
    else if (cls === 'mage')               this._showFireballEffect(x, y, key);
    else if (cls === 'rogue')              this._showBlinkEffect(x, y, key);
  }

  // Visi skill efektai eina per bendrą combatEffects modulį — vienodi su Arena.
  _showGuardBreakEffect(x, y) {
    showGuardBreak(this, { fromX: x, fromY: y, toX: BOSS_X, toY: BOSS_Y - 20, hit: true });
  }

  _showBashEffect(x, y, abilityKey = '') {
    showBash(this, { x, y: y - 40, hit: true, abilityKey });
  }

  _showFireballEffect(fromX, fromY, abilityKey = '') {
    // Taikom į bosą; toY-30 (modulyje) → smūgis ties BOSS_Y-80, kaip anksčiau
    showFireball(this, { fromX, fromY, toX: BOSS_X, toY: BOSS_Y - 50, hit: true, abilityKey });
  }

  _showBlinkEffect(fromX, fromY, abilityKey = '') {
    const toX = Math.min(fromX + Phaser.Math.Between(70, 130), PLAYER_STOP_X - 10);
    showBlink(this, { fromX, fromY, toX, abilityKey });
    this._myPlayerX = toX; // lokalus teleportas (BossRaid client movement)
    // Pozicijos sync iškart — cast animacija užrakina update() judėjimą, todėl be šito
    // sprite'as persikeltų tik po anim pabaigos (vizualus blink delay)
    this._syncMyPlayerVisuals(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PARTICLE TEXTURES
  // ─────────────────────────────────────────────────────────────────────────

  _createParticleTextures() {
    const mk = (color, r, name) => {
      const g = this.make.graphics({ add: false });
      g.fillStyle(color, 1); g.fillCircle(r, r, r);
      g.generateTexture(name, r * 2, r * 2); g.destroy();
    };
    mk(0xcc1111, 4, 'hit_particle');
    mk(0xff6600, 3, 'fire_particle');
    mk(0x00ffcc, 4, 'smoke_particle');
    mk(0xaabbcc, 8, 'fog_particle');

    this.hitEmitter = this.add.particles(0, 0, 'hit_particle', {
      speed: { min: 80, max: 220 }, angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 }, alpha: { start: 1, end: 0 },
      lifespan: 400, quantity: 1, emitting: false,
    });
    this.hitEmitter.setDepth(4);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ARENA BACKGROUND
  // ─────────────────────────────────────────────────────────────────────────

  _buildArena() {
    this.add.rectangle(W / 2, H / 2,        W, H,    0x04040c);
    this.add.rectangle(W / 2, 160,          W, 320,  0x07071a);
    this.add.rectangle(W / 2, 230,          W, 200,  0x0a0a20);
    this.add.rectangle(W / 2, 300,          W, 120,  0x0d0d26);
    this.add.rectangle(W / 2, FLOOR_Y - 10, W, 20,   0x10102c).setAlpha(0.7);

    this._buildStands();

    this.add.rectangle(W / 2, 84, W, 4, 0x1e1e40).setAlpha(0.8);

    [42, 110, W - 110, W - 42].forEach((px) => {
      this.add.rectangle(px, H / 2,       44, H,  0x1c1c2e);
      this.add.rectangle(px - 20, H / 2,   4, H,  0x2a2a45).setAlpha(0.6);
      this.add.rectangle(px, 30,          52, 20, 0x222238);
      this.add.rectangle(px, FLOOR_Y + 12,52, 24, 0x1a1a30);
    });

    [42, 110, W - 110, W - 42].forEach((tx) => this._addTorch(tx, 80));

    this.add.rectangle(W / 2, FLOOR_Y + 18, W, 36, 0x16162a);
    this.add.rectangle(W / 2, FLOOR_Y + 2,  W, 4,  0x20204a);
    this.add.rectangle(W / 2, FLOOR_Y,      W, 2,  0xc9a84c).setAlpha(0.55);
    for (let x = 80; x < W; x += 80) {
      this.add.rectangle(x, FLOOR_Y + 18, 1, 36, 0x22224a).setAlpha(0.4);
    }
    const glow = this.add.rectangle(W / 2, FLOOR_Y + 2, 300, 6, 0xc9a84c).setAlpha(0.06);
    this.tweens.add({ targets: glow, alpha: { from: 0.04, to: 0.12 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    [[18, 36, 0.40], [62, 52, 0.18], [112, 40, 0.07]].forEach(([cx, w, a]) => {
      this.add.rectangle(cx,     H / 2, w, H, 0x000000, a).setDepth(0);
      this.add.rectangle(W - cx, H / 2, w, H, 0x000000, a).setDepth(0);
    });

    this.add.text(W / 2, 14, 'BOSS RAID', {
      fontSize: '13px', fontFamily: 'monospace', color: '#c9a84c', fontStyle: 'bold', letterSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(5);
  }

  _buildStands() {
    [{ y: 30, rowH: 22, color: 0x0e0e20 }, { y: 52, rowH: 20, color: 0x0c0c1c }, { y: 72, rowH: 18, color: 0x0a0a18 }]
      .forEach(({ y, rowH, color }) => this.add.rectangle(W / 2, y, W, rowH, color));

    let seed = 42;
    const count = this._isMobile ? 30 : 90;
    for (let i = 0; i < count; i++) {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const sx  = 10 + (seed % (W - 20));
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const sy  = 20 + Math.floor(((seed & 0x7fffffff) / 0x7fffffff) * 52);
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      const col = CROWD_COLORS[Math.floor(((seed & 0x7fffffff) / 0x7fffffff) * CROWD_COLORS.length)];
      const sp  = this.add.rectangle(sx, sy, 3, 5, col).setAlpha(0.55 + (seed % 30) / 100);
      this.spectators.push({ obj: sp, baseY: sy });
    }
  }

  _buildFloorFog() {
    this.add.particles(W / 2, FLOOR_Y - 4, 'fog_particle', {
      x: { min: -W / 2, max: W / 2 }, y: { min: -6, max: 6 },
      speedY: { min: -12, max: -4 }, speedX: { min: -8, max: 8 },
      scale: { start: 1.6, end: 0 }, alpha: { start: 0.13, end: 0 },
      tint: [0x8899bb, 0xaabbcc, 0x99aacc],
      lifespan: { min: 3200, max: 5500 }, quantity: 1, frequency: 180, depth: 1,
    });
  }

  _addTorch(x, y) {
    const lp = this.add.circle(x, y + 60, 70, 0xff8800, 0.055);
    this.tweens.add({ targets: lp, alpha: { from: 0.035, to: 0.085 }, duration: 1800 + Math.random() * 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const halo = this.add.circle(x, y, 38, 0xff9900, 0.07);
    this.tweens.add({ targets: halo, alpha: { from: 0.04, to: 0.11 }, duration: 1400 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 200 });
    const glow   = this.add.circle(x, y + 4, 14, 0xff6600, 0.12);
    this.add.rectangle(x, y + 12, 4, 16, 0x5c3d1e);
    const flame1 = this.add.rectangle(x, y - 2,  6, 14, 0xff8800, 0.9);
    const flame2 = this.add.rectangle(x, y - 6,  4,  8, 0xffcc00, 0.85);
    const spark  = this.add.rectangle(x, y - 10, 2,  4, 0xffffff, 0.7);
    [flame1, flame2, spark, glow].forEach((obj, i) => {
      this.torchTweens.push(this.tweens.add({
        targets: obj, alpha: { from: obj.alpha * 0.6, to: obj.alpha },
        scaleY: { from: 0.85, to: 1.15 }, y: obj.y + (i < 3 ? -2 : 0),
        duration: 220 + i * 40 + Math.random() * 80, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut', delay: i * 60,
      }));
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ANIMATIONS
  // ─────────────────────────────────────────────────────────────────────────

  _registerBossAnimations() {
    if (!this.textures.exists('wartotaur')) return;
    Object.entries(BOSS_ANIM_DEFS).forEach(([name, def]) => {
      const key = `boss_${name}`;
      if (!this.anims.exists(key)) {
        this.anims.create({ key, frames: this.anims.generateFrameNumbers('wartotaur', { frames: def.frames }), frameRate: def.rate, repeat: def.loop });
      }
    });
  }

  _registerAllClassAnimations() {
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      const texKey = `cls_${cls}`;
      if (this.textures.exists(texKey)) this._registerBodyAnims(texKey, texKey, CLASS_COLS[cls] ?? 13);
    });
  }

  _registerBodyAnims(textureKey, animPrefix, cols) {
    if (!this.textures.exists(textureKey)) return;
    const F = makeF(cols);
    Object.entries(ANIM_ROW_DEFS).forEach(([name, def]) => {
      const key = `${animPrefix}_${name}`;
      if (!this.anims.exists(key)) {
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(textureKey, { frames: def.rowFn(F) }), frameRate: def.rate, repeat: def.loop });
      }
    });
  }

  _registerWeaponAnimations() {
    ['warrior', 'mage', 'rogue'].forEach((cls) => {
      const key = `${cls}_weapon`;
      if (!this.textures.exists(key)) return;
      const Fw   = makeF(WEAPON_SHEET_COLS[cls] ?? 18);
      const rows = WEAPON_ANIM_ROWS[cls];
      const holdFrame    = Fw(rows.idle, rows.idleCol ?? 0);
      const attackFrames = rows.attackCols
        ? rows.attackCols.map((col) => Fw(rows.attack, col))
        : Array.from({ length: rows.attackFrames }, (_, i) => Fw(rows.attack, i));
      const defs = {
        idle:   { frames: [holdFrame], rate: 1, loop: -1 },
        walk:   { frames: Array.from({ length: rows.walkFrames }, (_, i) => Fw(rows.walk, (rows.walkStartCol ?? 0) + i)), rate: 9, loop: -1 },
        attack: { frames: attackFrames, rate: 10, loop: 0 },
        hurt:   { frames: [Fw(rows.hurt, 0), Fw(rows.hurt, 1), Fw(rows.hurt, 2)], rate: 8, loop: 0 },
        dead:   { frames: Array.from({ length: 6 }, (_, i) => Fw(rows.dead, i)), rate: 6, loop: 0 },
        jump:   { frames: [holdFrame], rate: 1, loop: -1 },
      };
      Object.entries(defs).forEach(([name, def]) => {
        const animKey = `${cls}_weapon_${name}`;
        if (!this.anims.exists(animKey)) {
          this.anims.create({ key: animKey, frames: this.anims.generateFrameNumbers(key, { frames: def.frames }), frameRate: def.rate, repeat: def.loop });
        }
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BOSS BUILD
  // ─────────────────────────────────────────────────────────────────────────

  _buildBoss() {
    if (this.textures.exists('wartotaur')) {
      this._bossSprite = this.add.sprite(BOSS_X, BOSS_Y, 'wartotaur')
        .setOrigin(0.5, 1.0).setScale(BOSS_SCALE).setFlipX(true).setDepth(6);
      this._bossSprite.play('boss_idle');
    } else {
      const g = this.add.graphics().setDepth(6);
      g.fillStyle(0x8b0000, 1);
      g.fillRect(BOSS_X - 55, BOSS_Y - 155, 110, 155);
      g.lineStyle(2, 0xcc2200, 0.8);
      g.strokeRect(BOSS_X - 55, BOSS_Y - 155, 110, 155);
      this._bossSprite = g;
    }

    const labelY = BOSS_Y - BOSS_FRAME * BOSS_SCALE - 14;
    this._bossLabel = this.add.text(BOSS_X, labelY, 'BOSS', {
      fontSize: '15px', fontFamily: 'monospace', fontStyle: 'bold',
      color: '#ef4444', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(8);

    const hw = (BOSS_FRAME * BOSS_SCALE) / 2;
    this._hurtFlash = this.add.graphics().setDepth(9).setAlpha(0);
    this._hurtFlash.fillStyle(0xff3300, 0.60);
    this._hurtFlash.fillRect(BOSS_X - hw, BOSS_Y - hw * 2, hw * 2, hw * 2);

    this._bossStartIdle();
  }

  _buildAttackerSlots() {
    this._attackerSlots = ATTACKER_SLOTS_X.map((x, idx) => ({
      x, y: FLOOR_Y + FOOT_OFFSET, sprite: null, nameText: null, cls: null, sheetKey: null, active: false,
      bounceTween: null, idx, sessionId: null, lpcState: 'idle', desiredState: null,
      curX: null, targetX: null, facingRight: true, moveAnim: null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // APPLY RAID DATA
  // ─────────────────────────────────────────────────────────────────────────

  _applyRaidData(opts) {
    if (!opts) return;
    if (opts.myUserId != null) this._myUserId = String(opts.myUserId);
    if (opts.bossHp    != null) this._bossHp    = opts.bossHp;
    if (opts.bossMaxHp != null) this._bossMaxHp = opts.bossMaxHp;
    if (opts.bossPhase != null) {
      this._bossPhase = opts.bossPhase;
      this._applyPhaseVisuals(this._bossPhase);
    }
    if (this._bossLabel && opts.bossName) this._bossLabel.setText(opts.bossName.toUpperCase());
    if (opts.myPlayer) this._spawnMyPlayer(opts.myPlayer);
    if (Array.isArray(opts.recentAttackers)) {
      const others = opts.recentAttackers.filter((p) => this._myUserId == null || String(p.user_id) !== this._myUserId);
      others.slice(0, 5).forEach((p, i) => this._populateAttackerSlot(i, p));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MY PLAYER SPAWN
  // ─────────────────────────────────────────────────────────────────────────

  _spawnMyPlayer(playerData) {
    const cls       = String(playerData.class_name || playerData.class || 'warrior').toLowerCase();
    const sheetPath = playerData.sheetPath || playerData.character_spritesheet_path || null;
    const enchant   = playerData.weaponEnchant || playerData.enchant_level || 0;
    const username  = playerData.username || playerData.first_name || 'You';

    const doSpawn = (texKey, originY, cols) => {
      this._destroyMyPlayer();
      this._registerBodyAnims(texKey, texKey, cols);
      const visualY = FLOOR_Y + FOOT_OFFSET;
      const topY    = visualY - SPRITE_HEIGHT;
      const hpY     = topY - 10;
      const nameY   = topY - 22;

      const shadow = this.add.ellipse(this._myPlayerX, visualY + 2, 64, 14, 0x000000, 0.45).setDepth(1);
      const aura   = this.add.circle(this._myPlayerX, visualY - SPRITE_HEIGHT / 2, 34, CLASS_COLORS[cls] ?? 0xe74c3c, 0.20).setDepth(1);

      const body = this.add.sprite(this._myPlayerX, visualY, texKey)
        .setOrigin(0.5, originY).setScale(SPRITE_SCALE).setDepth(2).setFlipX(false);
      if (cls === 'rogue') body.setScale(SPRITE_SCALE, SPRITE_SCALE * 0.86);

      const idleKey = `${texKey}_idle`;
      if (this.anims.exists(idleKey)) body.play(idleKey, true);

      const hpBg  = this.add.rectangle(this._myPlayerX, hpY, 56, 7, 0x1a1a1a).setStrokeStyle(1, 0x444444).setDepth(3);
      const hpBar = this.add.rectangle(this._myPlayerX - 28, hpY, 56, 7, 0x22c55e).setOrigin(0, 0.5).setDepth(3);

      const nameLabel  = this.add.text(this._myPlayerX, nameY, username.slice(0, 12), {
        fontSize: '11px', fontFamily: 'monospace', color: '#facc15', fontStyle: 'bold',
      }).setOrigin(0.5, 1).setDepth(3);
      const classLabel = this.add.text(this._myPlayerX, nameY + 11, cls.toUpperCase(), {
        fontSize: '9px', fontFamily: 'monospace', color: CLASS_HEX[cls] ?? '#e74c3c',
      }).setOrigin(0.5, 1).setDepth(3);
      const meTag = this.add.text(this._myPlayerX, topY - 36, '▼ YOU', {
        fontSize: '9px', fontFamily: 'monospace', color: '#facc15', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(3);

      this._myPlayer = {
        body, shadow, aura, weapon: null, hpBg, hpBar, nameLabel, classLabel, meTag,
        enchantTrail: null, cls, animPrefix: texKey, usesGenerated: originY !== 1.0,
        deathPlayed: false, lastState: '', _weaponSwingTween: null,
      };
      this._myPlayerState = 'idle';
    };

    if (sheetPath?.startsWith('/generated/')) {
      // Generuotas charakteris — reikia atsisiųsti iš backend serverio dinamiškai.
      // Phaser preload() buvo jau baigtas, todėl naudojame this.load rankiniu būdu.
      const url     = resolveSheetUrl(sheetPath);
      const safeKey = `myboss_${sheetPath.replace(/[^A-Za-z0-9]/g, '_')}`; // URL→tekstūros raktas (be specialių simbolių)
      if (this.textures.exists(safeKey)) { doSpawn(safeKey, 0.75, 13); return; } // jau cache'uota
      if (this._dynamicLoads.has(safeKey)) return; // jau kraunama — nelaukti
      this._dynamicLoads.add(safeKey);
      this.load.spritesheet(safeKey, url, { frameWidth: 128, frameHeight: 128 });
      // once() = klauso įvykio vieną kartą ir automatiškai nusiregistruoja
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this._dynamicLoads.delete(safeKey);
        if (this.textures.exists(safeKey)) doSpawn(safeKey, 0.75, 13);
        else this._spawnClassFallback(cls, enchant, username); // jei nepavyko — fallback
      });
      if (!this.load.isLoading()) this.load.start(); // pradedame atsisiuntimą
    } else {
      // Nėra generuoto karakterio — naudojame standartinį klasės sprite'ą
      this._spawnClassFallback(cls, enchant, username);
    }
  }

  _spawnClassFallback(cls, enchant, username) {
    const texKey = `cls_${cls}`;
    if (this.textures.exists(texKey)) {
      this._destroyMyPlayer();
      this._registerBodyAnims(texKey, texKey, CLASS_COLS[cls] ?? 13);
      const visualY = FLOOR_Y + FOOT_OFFSET;
      const topY    = visualY - SPRITE_HEIGHT;
      const hpY     = topY - 10;
      const nameY   = topY - 22;

      const shadow = this.add.ellipse(this._myPlayerX, visualY + 2, 64, 14, 0x000000, 0.45).setDepth(1);
      const aura   = this.add.circle(this._myPlayerX, visualY - SPRITE_HEIGHT / 2, 34, CLASS_COLORS[cls] ?? 0xe74c3c, 0.20).setDepth(1);
      const body   = this.add.sprite(this._myPlayerX, visualY, texKey)
        .setOrigin(0.5, 1.0).setScale(SPRITE_SCALE).setDepth(2).setFlipX(false);
      if (cls === 'rogue') body.setScale(SPRITE_SCALE, SPRITE_SCALE * 0.86);

      const idleKey = `${texKey}_idle`;
      if (this.anims.exists(idleKey)) body.play(idleKey, true);

      const hpBg  = this.add.rectangle(this._myPlayerX, hpY, 56, 7, 0x1a1a1a).setStrokeStyle(1, 0x444444).setDepth(3);
      const hpBar = this.add.rectangle(this._myPlayerX - 28, hpY, 56, 7, 0x22c55e).setOrigin(0, 0.5).setDepth(3);
      const nameLabel  = this.add.text(this._myPlayerX, nameY, (username || 'You').slice(0, 12), {
        fontSize: '11px', fontFamily: 'monospace', color: '#facc15', fontStyle: 'bold',
      }).setOrigin(0.5, 1).setDepth(3);
      const classLabel = this.add.text(this._myPlayerX, nameY + 11, cls.toUpperCase(), {
        fontSize: '9px', fontFamily: 'monospace', color: CLASS_HEX[cls] ?? '#e74c3c',
      }).setOrigin(0.5, 1).setDepth(3);
      const meTag = this.add.text(this._myPlayerX, topY - 36, '▼ YOU', {
        fontSize: '9px', fontFamily: 'monospace', color: '#facc15', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(3);

      this._myPlayer = {
        body, shadow, aura, weapon: null, hpBg, hpBar, nameLabel, classLabel, meTag,
        enchantTrail: null, cls, animPrefix: texKey, usesGenerated: false,
        deathPlayed: false, lastState: '', _weaponSwingTween: null,
      };
      this._myPlayerState = 'idle';
    } else {
      // Last resort colored rect
      this._destroyMyPlayer();
      const visualY = FLOOR_Y + FOOT_OFFSET;
      const g = this.add.graphics().setDepth(2);
      g.fillStyle(CLASS_COLORS[cls] ?? 0x4a90d9, 0.9);
      g.fillRect(-18, -46, 36, 46);
      const letter = this.add.text(0, -23, cls[0].toUpperCase(), {
        fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
      }).setOrigin(0.5);
      const container = this.add.container(this._myPlayerX, visualY, [g, letter]).setDepth(2);
      this._myPlayer = {
        body: container, shadow: null, aura: null, weapon: null,
        hpBg: null, hpBar: null, nameLabel: null, classLabel: null, meTag: null,
        enchantTrail: null, cls, animPrefix: null, usesGenerated: false,
        deathPlayed: false, lastState: '', _weaponSwingTween: null,
      };
    }
  }

  _destroyMyPlayer() {
    if (!this._myPlayer) return;
    const p = this._myPlayer;
    if (p.enchantTrail?.active) p.enchantTrail.destroy();
    [p.body, p.shadow, p.aura, p.weapon, p.hpBg, p.hpBar, p.nameLabel, p.classLabel, p.meTag]
      .forEach((o) => o?.destroy?.());
    this._myPlayer = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEAPON HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  _createHeldWeapon(cls, x, visualY, facingRight) {
    const key = `${cls}_held_weapon`;
    if (!this.textures.exists(key)) return null;
    const pose = HELD_WEAPON_POSE[cls] ?? HELD_WEAPON_POSE.warrior;
    const xMul = facingRight ? 1 : -1;
    const w = this.add.image(x + xMul * pose.xOff, visualY + pose.yOff, key);
    w.setOrigin(0.5, 0.5).setScale(pose.scale);
    w.setRotation(Phaser.Math.DegToRad((pose.rotation || 0) * xMul));
    w.setFlipX(!facingRight).setDepth(2.8);
    return w;
  }

  _syncHeldWeaponPos(p, x, visualY) {
    if (!p.weapon?.active || p._weaponSwingTween) return;
    const pose = HELD_WEAPON_POSE[p.cls] ?? HELD_WEAPON_POSE.warrior;
    const xMul = this._myPlayerFacing;
    p.weapon.setPosition(x + xMul * pose.xOff, visualY + pose.yOff);
    p.weapon.setFlipX(this._myPlayerFacing < 0);
    p.weapon.setRotation(Phaser.Math.DegToRad((pose.rotation || 0) * xMul));
  }

  _swingHeldWeapon(p) {
    if (!p.weapon?.active) return;
    const pose = HELD_WEAPON_POSE[p.cls] ?? HELD_WEAPON_POSE.warrior;
    const xMul = this._myPlayerFacing;
    const x    = this._myPlayerX;
    const vY   = FLOOR_Y + FOOT_OFFSET;
    const base = (pose.rotation || 0) * xMul;
    p.weapon.setPosition(x - xMul * 6, vY + pose.yOff + 4);
    p.weapon.setScale(pose.scale * 1.06);
    p.weapon.setRotation(Phaser.Math.DegToRad(base - 65 * xMul));
    if (p._weaponSwingTween) p._weaponSwingTween.stop();
    p._weaponSwingTween = this.tweens.add({
      targets: p.weapon,
      x:        x + xMul * pose.xOff + xMul * 24,
      y:        vY + pose.yOff - 8,
      scale:    pose.scale * 1.18,
      rotation: Phaser.Math.DegToRad(base + 78 * xMul),
      duration: 135, yoyo: true, ease: 'Sine.easeOut',
      onComplete: () => {
        p._weaponSwingTween = null;
        if (p.weapon?.active) {
          p.weapon.setPosition(x + xMul * pose.xOff, vY + pose.yOff);
          p.weapon.setScale(pose.scale);
          p.weapon.setRotation(Phaser.Math.DegToRad(base));
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MY PLAYER SYNC (per frame)
  // ─────────────────────────────────────────────────────────────────────────

  // Kviečiama kiekvieną kadrą (iš update()). Perskaito _myPlayerX ir _jumpOffsetY
  // ir perkelia VISUS susijusius objektus į teisingą poziciją.
  // Visos pozicijos skaičiuojamos iš naujo kas kadrą — paprasčiau nei sekti delta'as.
  _syncMyPlayerVisuals(moving) {
    const p = this._myPlayer;
    if (!p?.body?.active) return;
    const visualY = FLOOR_Y + FOOT_OFFSET;
    const bodyY   = visualY - this._jumpOffsetY; // šuolio metu bodyY kyla aukštyn

    // Sprite visada nustatomas tiesiogiai — ne per fizikos variklį (BossRaid neturi fizikos)
    if (p.body.setPosition) p.body.setPosition(this._myPlayerX, bodyY);
    else { p.body.x = this._myPlayerX; p.body.y = bodyY; }
    if (p.body.setFlipX) p.body.setFlipX(this._myPlayerFacing < 0);

    if (p.shadow?.active) p.shadow.setPosition(this._myPlayerX, visualY + 2); // šešėlis lieka ant grindų
    if (p.aura?.active)   p.aura.setPosition(this._myPlayerX, bodyY - SPRITE_HEIGHT / 2);
    if (p.weapon?.active && !p._weaponSwingTween) this._syncHeldWeaponPos(p, this._myPlayerX, bodyY);
    if (p.enchantTrail?.active) {
      p.enchantTrail.setPosition(this._myPlayerX + this._myPlayerFacing * 16, bodyY - 52);
    }

    // HP bar ir etiketės seka sprite'ą
    const topY  = bodyY - SPRITE_HEIGHT;
    const hpY   = topY - 10;
    const nameY = topY - 22;
    if (p.hpBg?.active)       p.hpBg.setPosition(this._myPlayerX, hpY);
    if (p.hpBar?.active)      p.hpBar.setPosition(this._myPlayerX - 28, hpY);
    if (p.nameLabel?.active)  p.nameLabel.setPosition(this._myPlayerX, nameY);
    if (p.classLabel?.active) p.classLabel.setPosition(this._myPlayerX, nameY + 11);
    if (p.meTag?.active)      p.meTag.setPosition(this._myPlayerX, topY - 36);

    // Animacijos state machine — nekeičiame animacijos jei atakuojame arba šokinėjame
    // Tik du perėjimai čia: idle ↔ walk. Attack/jump animacijos valdomos atskirai.
    if (!p.animPrefix || this._myPlayerState === 'attacking' || this._isJumping) return;
    const want = moving ? 'walk' : 'idle';
    if (want !== this._myPlayerState) {
      this._myPlayerState = want;
      const bk = `${p.animPrefix}_${want}`;
      if (this.anims.exists(bk) && p.body.play) p.body.play(bk, true);
      if (p.weapon?.active) {
        const wk = `${p.cls}_weapon_${want}`;
        if (this.anims.exists(wk)) p.weapon.play?.(wk, true);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OTHER ATTACKER SLOTS
  // ─────────────────────────────────────────────────────────────────────────

  _populateAttackerSlot(index, playerData) {
    if (index >= this._attackerSlots.length || !playerData) return;
    const slot = this._attackerSlots[index];
    slot.active = true;
    const cls  = String(playerData.class_name || playerData.class || 'warrior').toLowerCase();
    slot.cls   = cls;

    if (!slot.nameText) {
      slot.nameText = this.add.text(slot.x, slot.y - 130, '', {
        fontSize: '9px', fontFamily: 'monospace', color: '#94a3b8', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5, 1).setDepth(7).setVisible(false);
    }
    slot.nameText.setText((playerData.username || playerData.first_name || `P${index + 1}`).slice(0, 8)).setVisible(true);

    const sheetPath = playerData.sheetPath || playerData.character_spritesheet_path || null;
    if (sheetPath?.startsWith('/generated/')) {
      this._loadAttackerSheet(slot, cls, sheetPath);
    } else {
      this._spawnAttackerFallback(slot, cls);
    }
  }

  _loadAttackerSheet(slot, cls, sheetPath) {
    const url = resolveSheetUrl(sheetPath);
    if (!url) { this._spawnAttackerFallback(slot, cls); return; }
    const safeKey = `ra_${sheetPath.replace(/[^A-Za-z0-9]/g, '_')}`;
    slot.sheetKey = safeKey;
    const afterLoad = () => {
      if (!this.textures.exists(safeKey)) { this._spawnAttackerFallback(slot, cls); return; }
      this._registerBodyAnims(safeKey, safeKey, 13);
      this._spawnAttackerLpc(slot, safeKey, 0.75, SPRITE_SCALE);
    };
    if (this.textures.exists(safeKey)) { afterLoad(); return; }
    if (this._dynamicLoads.has(safeKey)) return;
    this._dynamicLoads.add(safeKey);
    this.load.spritesheet(safeKey, url, { frameWidth: 128, frameHeight: 128 });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => { this._dynamicLoads.delete(safeKey); afterLoad(); });
    if (!this.load.isLoading()) this.load.start();
  }

  _spawnAttackerFallback(slot, cls) {
    const texKey = `cls_${cls}`;
    if (this.textures.exists(texKey)) {
      slot.sheetKey = texKey;
      this._registerBodyAnims(texKey, texKey, CLASS_COLS[cls] ?? 13);
      this._spawnAttackerLpc(slot, texKey, 1.0, SPRITE_SCALE);
    } else {
      this._spawnAttackerRect(slot, cls);
    }
  }

  _spawnAttackerLpc(slot, texKey, originY, scale) {
    if (slot.bounceTween) { slot.bounceTween.stop(); slot.bounceTween = null; }
    if (slot.sprite?.active) slot.sprite.destroy();
    const sprite = this.add.sprite(slot.x, slot.y, texKey)
      .setOrigin(0.5, originY).setScale(scale).setDepth(4).setFlipX(false);
    if (slot.cls === 'rogue') sprite.setScale(scale, scale * 0.86); // toks pat squash kaip my player
    slot.sprite = sprite;
    const ik = `${texKey}_idle`;
    const ak = `${texKey}_attack`;
    if (this.anims.exists(ik)) sprite.play(ik);       // idle ant spawn (ne attack)
    else if (this.anims.exists(ak)) sprite.play(ak);
    // BE "bounce" tween — žaidėjas stovi ant žemės kaip my player (anksčiau plūduriavo)
    // Phase 4: jei serveris jau pranešė šio žaidėjo veiksmo būseną, pritaikome ją dabar
    if (slot.desiredState != null) { slot.lpcState = null; this._applyLivePlayerState(slot, slot.desiredState); }
  }

  _spawnAttackerRect(slot, cls) {
    if (slot.bounceTween) { slot.bounceTween.stop(); slot.bounceTween = null; }
    if (slot.sprite?.active) slot.sprite.destroy();
    const g = this.add.graphics().setDepth(4);
    g.fillStyle(CLASS_COLORS[cls] ?? 0x888888, 0.75);
    g.fillRect(slot.x - 12, slot.y - 38, 24, 38);
    const letter = this.add.text(slot.x, slot.y - 20, cls[0].toUpperCase(), {
      fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5).setDepth(5);
    slot.sprite = this.add.container(0, 0, [g, letter]).setDepth(4);
    slot.sheetKey = `fb_${cls}`;
    slot.bounceTween = this.tweens.add({ targets: slot.sprite, y: `-=${6}`, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: slot.idx * 120 });
  }

  _refreshAttackers(attackers) {
    if (this._liveMode) return; // live Colyseus žaidėjai turi pirmenybę prieš REST snapshot
    const others = attackers.filter((a) => this._myUserId == null || String(a.user_id) !== this._myUserId);
    others.slice(0, 5).forEach((attacker, i) => {
      const slot = this._attackerSlots[i];
      if (!slot) return;
      const newCls = String(attacker.class_name || attacker.class || 'warrior').toLowerCase();
      const newPath = attacker.sheetPath || attacker.character_spritesheet_path || null;
      const newKey  = newPath ? `ra_${newPath.replace(/[^A-Za-z0-9]/g, '_')}` : `cls_${newCls}`;
      if (slot.active && slot.sheetKey === newKey) return;
      this._populateAttackerSlot(i, attacker);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 4: LIVE PLAYERS (server-authoritative action state)
  // ─────────────────────────────────────────────────────────────────────────
  // Serveris (BossRaidRoom) yra vienintelis šaltinis kiekvieno žaidėjo veiksmo
  // būsenai (idle | moving | attacking | hit | dead). React komponentas perduoda
  // kiekvieno žaidėjo pakitimą čia, o scena tik renderina atitinkamą animaciją.

  // Sukuria arba atnaujina kito žaidėjo sprite'ą pagal serverio state.
  upsertRaidPlayer(data) {
    if (!this._sceneReady || !data?.sessionId) return;

    // Pirmas live žaidėjas — perjungiame iš REST snapshot į live režimą ir
    // išvalome senus statiškus slot'us, kad nesidubliuotų.
    if (!this._liveMode) {
      this._liveMode = true;
      this._clearAllAttackerSlots();
    }

    let idx = this._sessionSlots.get(data.sessionId);
    if (idx == null) {
      idx = this._attackerSlots.findIndex(
        (s, i) => !s.active && ![...this._sessionSlots.values()].includes(i)
      );
      if (idx < 0) return; // visi 5 slot'ai užimti — >5 vienu metu matomų žaidėjų atidėta (Phase 8 polish)
      this._sessionSlots.set(data.sessionId, idx);
    }

    const slot = this._attackerSlots[idx];
    if (!slot) return;

    const cls     = String(data.characterClass || 'warrior').toLowerCase();
    const path    = data.spritesheetPath || data.sheetPath || null;
    const wantKey = path ? `ra_${path.replace(/[^A-Za-z0-9]/g, '_')}` : `cls_${cls}`;
    const state   = data.state || 'idle';

    // Phase 5: pozicija/kryptis iš serverio — interpoliaciją daro _updateLivePlayers()
    if (typeof data.x === 'number') {
      slot.targetX = data.x;
      if (slot.curX == null) slot.curX = data.x; // pirmą kartą — snap (be šliaužimo iš slot.x)
    }
    if (typeof data.facingRight === 'boolean') slot.facingRight = data.facingRight;

    // desiredState išsaugomas slot'e — generuoti sheet'ai kraunasi async, todėl
    // sprite'as gali atsirasti vėliau; spawn helper'is tada pritaikys šią būseną.
    slot.desiredState = state;

    // (Per)kuriame sprite'ą tik jei dar nėra arba pasikeitė charakteris
    if (!slot.active || slot.sheetKey !== wantKey || slot.sessionId !== data.sessionId) {
      slot.sessionId = data.sessionId;
      this._populateAttackerSlot(idx, {
        username:   data.username,
        class_name: cls,
        sheetPath:  path,
      });
      slot.lpcState = null; // priverčia _applyLivePlayerState perrašyti spawn-metu paleistą anim
      slot.moveAnim = null; // priverčia _updateLivePlayers iš naujo parinkti walk/idle
    }

    // Jei sprite jau yra (cache'uotas/fallback) — pritaikome iškart; jei dar kraunasi,
    // _spawnAttackerLpc pritaikys desiredState kai sprite atsiras.
    this._applyLivePlayerState(slot, state);
  }

  removeRaidPlayer(sessionId) {
    const idx = this._sessionSlots.get(sessionId);
    if (idx == null) return;
    this._sessionSlots.delete(sessionId);
    const slot = this._attackerSlots[idx];
    if (slot) this._deactivateSlot(slot);
  }

  // Renderina serverio nustatytą veiksmo būseną viename slot'e.
  // idle/moving anim NEvaldoma čia — ją kas kadrą parenka _updateLivePlayers()
  // pagal realų judėjimą. Čia tik vienkartinės animacijos: attack/hit/dead.
  _applyLivePlayerState(slot, state) {
    if (!slot?.sprite?.active || !slot.sheetKey) return;
    if (slot.lpcState === state) return; // nieko nepasikeitė
    // idle/moving → 'idle' (walk/idle parenka movement loop'as); downed → 'dead' anim
    const norm = (state === 'moving') ? 'idle' : (state === 'downed') ? 'dead' : state;
    slot.lpcState = norm;

    const base = slot.sheetKey;
    const has  = (suffix) => this.anims.exists(`${base}_${suffix}`);
    const toIdle = () => {
      if (!slot.sprite?.active) return;
      slot.lpcState = 'idle';
      slot.moveAnim = null; // _updateLivePlayers vėl parinks walk/idle
    };

    if (norm === 'attacking' && has('attack')) {
      slot.sprite.play(`${base}_attack`, true);
      slot.sprite.once('animationcomplete', () => { if (slot.lpcState === 'attacking') toIdle(); });
    } else if (norm === 'hit' && has('hurt')) {
      slot.sprite.play(`${base}_hurt`, true);
      slot.sprite.once('animationcomplete', () => { if (slot.lpcState === 'hit') toIdle(); });
    } else if (norm === 'dead' && has('dead')) {
      slot.sprite.play(`${base}_dead`, true);
    } else {
      // idle — leidžiame movement loop'ui parinkti walk/idle iš naujo
      slot.moveAnim = null;
    }
  }

  _deactivateSlot(slot) {
    if (slot.bounceTween) { slot.bounceTween.stop(); slot.bounceTween = null; }
    if (slot.sprite?.active) slot.sprite.destroy();
    slot.sprite   = null;
    slot.sheetKey = null;
    slot.cls      = null;
    slot.active   = false;
    slot.sessionId = null;
    slot.lpcState = 'idle';
    slot.desiredState = null;
    slot.curX     = null;
    slot.targetX  = null;
    slot.facingRight = true;
    slot.moveAnim = null;
    if (slot.nameText?.active) slot.nameText.setVisible(false);
  }

  _clearAllAttackerSlots() {
    this._attackerSlots.forEach((slot) => this._deactivateSlot(slot));
  }

  // Serveris pranešė kad bosas atakuoja — rodome smūgį sinchroniškai visiems.
  // Pataikytų žaidėjų "hit" animacija ateina atskirai per jų state pakitimą.
  onBossAttack() {
    if (!this._sceneReady) return;
    // Pirmas serverio signalas — nutraukiame autonominį (client-side) boso ciklą
    if (!this._serverDrivenBoss) {
      this._serverDrivenBoss = true;
      if (this._bossAttackTimer) { this._bossAttackTimer.remove(); this._bossAttackTimer = null; }
    }
    if (this._bossDeadPlayed || this._bossStatus === 'defeated') return;
    this._doBossAttack();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BOSS ATTACK LOOP
  // ─────────────────────────────────────────────────────────────────────────

  _startBossAttackLoop() {
    if (this._bossAttackTimer) { this._bossAttackTimer.remove(); this._bossAttackTimer = null; }
    if (this._serverDrivenBoss) return; // boso atakas valdo serveris (Phase 4)
    if (this._bossDeadPlayed) return;
    const minMs = this._bossPhase >= 3 ? 1200 : this._bossPhase === 2 ? 2000 : 2800;
    const maxMs = this._bossPhase >= 3 ? 2400 : this._bossPhase === 2 ? 3500 : 5000;
    this._bossAttackTimer = this.time.delayedCall(Phaser.Math.Between(minMs, maxMs), () => {
      if (!this._bossDeadPlayed && this._bossStatus !== 'defeated') this._doBossAttack();
    });
  }

  _doBossAttack() {
    if (!this._bossSprite?.active || this._bossDeadPlayed || this._bossIsAttacking) return;
    this._bossIsAttacking = true;
    if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }

    if (this._bossSprite.play) {
      this._bossSprite.play('boss_attack', true);
      this.time.delayedCall(120, () => {
        if (this._bossSprite?.active && !this._bossDeadPlayed) {
          this.tweens.add({ targets: this._bossSprite, x: BOSS_X - 40, duration: 120, ease: 'Power2', yoyo: true, hold: 60 });
        }
      });
      this._bossSprite.once('animationcomplete', () => {
        this._bossIsAttacking = false;
        if (!this._bossDeadPlayed) { this._bossStartIdle(); this._startBossAttackLoop(); }
      });
    } else {
      this.tweens.add({
        targets: this._bossSprite, x: BOSS_X - 30, duration: 80, yoyo: true, repeat: 2,
        onComplete: () => {
          this._bossIsAttacking = false;
          if (!this._bossDeadPlayed) { this._bossStartIdle(); this._startBossAttackLoop(); }
        },
      });
    }
    this._spawnBossSlash();
    if (this._bossPhase >= 3 && this.cameras?.main) this.cameras.main.shake(80, 0.006);
  }

  _spawnBossSlash() {
    const startX = BOSS_X - 80;
    const startY = BOSS_Y - 80;
    const g = this.add.graphics().setDepth(12);
    const color = this._bossPhase >= 3 ? 0xff2200 : this._bossPhase === 2 ? 0xff6600 : 0xcc2200;
    g.fillStyle(color, 0.85);
    g.slice(0, 0, 55, Phaser.Math.DegToRad(150), Phaser.Math.DegToRad(210), false);
    g.fillPath();
    g.x = startX; g.y = startY;
    this.tweens.add({
      targets: g, x: startX - 140,
      scaleX: { from: 1, to: 0.2 }, alpha: { from: 0.85, to: 0 },
      duration: 280, ease: 'Power2',
      onComplete: () => { if (g.active) g.destroy(); },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BOSS ANIMATION HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  _bossStartIdle() {
    if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }
    if (!this._bossSprite?.active) return;
    if (this._bossSprite.play) this._bossSprite.play('boss_idle');
    this._bossPulseTween = this.tweens.add({
      targets: this._bossSprite,
      scaleX: { from: BOSS_SCALE * 0.97, to: BOSS_SCALE * 1.03 },
      scaleY: { from: BOSS_SCALE * 0.97, to: BOSS_SCALE * 1.03 },
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
    if (this._bossPulseTween)  { this._bossPulseTween.stop(); this._bossPulseTween = null; }
    if (!this._bossSprite?.active) return;
    this.tweens.killTweensOf(this._bossSprite);

    // Death slow-mo — same as Arena BattleScene
    this.time.timeScale  = 0.3;
    this.tweens.timeScale = 0.3;
    setTimeout(() => {
      if (this.time && this.tweens && this.scene?.isActive('BossRaidScene')) {
        this.time.timeScale  = 1;
        this.tweens.timeScale = 1;
      }
    }, 300);

    if (this._bossSprite.play) {
      this._bossSprite.play('boss_death');
      this._bossSprite.once('animationcomplete', () => {
        if (this._bossSprite?.active) this.tweens.add({ targets: this._bossSprite, alpha: 0, duration: 500 });
      });
    } else {
      this.tweens.add({ targets: this._bossSprite, alpha: 0, duration: 600 });
    }
    if (this._bossLabel?.active) this.tweens.add({ targets: this._bossLabel, alpha: 0, duration: 400 });
    this._spawnDeathParticles();

    if (this.cameras?.main) {
      this.cameras.main.shake(200, 0.012);
      this.cameras.main.zoomTo(1.6, 600, 'Power2');
      this.time.delayedCall(800, () => {
        if (this.cameras?.main) this.cameras.main.zoomTo(1, 500, 'Sine.easeInOut');
      });
    }
  }

  _applyPhaseVisuals(phase) {
    if (!this._bossSprite?.active) return;
    if (phase === 2) {
      if (this._bossSprite.setTint) this._bossSprite.setTint(0xffaa44);
      this._bossPhaseRoar();
    } else if (phase >= 3) {
      if (this._bossSprite.setTint) this._bossSprite.setTint(0xff4444);
      if (this._bossPulseTween) { this._bossPulseTween.stop(); this._bossPulseTween = null; }
      this._bossPulseTween = this.tweens.add({
        targets: this._bossSprite,
        scaleX: { from: BOSS_SCALE * 0.94, to: BOSS_SCALE * 1.06 },
        scaleY: { from: BOSS_SCALE * 0.94, to: BOSS_SCALE * 1.06 },
        duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      this._bossPhaseRoar();
    } else {
      if (this._bossSprite.clearTint) this._bossSprite.clearTint();
      this._bossStartIdle();
    }
    this._startBossAttackLoop();
  }

  _bossPhaseRoar() {
    if (this.cameras?.main) this.cameras.main.shake(180, 0.01);
    const flash = this.add.graphics().setDepth(30);
    flash.fillStyle(0xffffff, 0.18);
    flash.fillRect(0, 0, W, H);
    this.tweens.add({ targets: flash, alpha: 0, duration: 300, onComplete: () => { if (flash.active) flash.destroy(); } });
    if (this._bossSprite?.active) {
      this.tweens.add({ targets: this._bossSprite, x: BOSS_X - 60, duration: 150, yoyo: true, ease: 'Power3' });
    }
  }

  _spawnDeathParticles() {
    const colors = [0xef4444, 0xff6600, 0xfbbf24, 0x8b0000];
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const speed = Phaser.Math.Between(60, 140);
      const size  = Phaser.Math.Between(3, 9);
      const g = this.add.graphics().setDepth(15);
      g.fillStyle(Phaser.Utils.Array.GetRandom(colors), 1);
      g.fillRect(-size / 2, -size / 2, size, size);
      g.x = BOSS_X; g.y = BOSS_Y - 100;
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
