// ─────────────────────────────────────────────────────────────────────────────
// Shared combat skill VFX — single source of truth for ability animations.
//
// Ported from the Arena BattleScene effects (the reference look). Both BattleScene
// and BossRaidScene call these so a Bash/Fireball/Blink looks identical in every
// mode. Each function takes the Phaser `scene` (for scene.add/tweens/cameras/time)
// plus an options object.
//
// Optional scene helpers are guarded so the module works in both scenes:
//   - scene._showCombatText?.(x, y, text, color)  — present in BattleScene only
//   - 'dust_particle' texture                      — present in BattleScene only
// ─────────────────────────────────────────────────────────────────────────────
import { W, H, FLOOR_Y, SPRITE_HEIGHT } from './combatSprites';

export function showFortify(scene, { x, y } = {}) {
  const cx = Number.isFinite(Number(x)) ? Number(x) : W / 2;
  const cy = Number.isFinite(Number(y)) ? Number(y) - 42 : FLOOR_Y - 42;
  const shield = scene.add.graphics().setDepth(10);
  shield.lineStyle(4, 0x60a5fa, 0.92);
  shield.fillStyle(0x1d4ed8, 0.14);
  shield.beginPath();
  shield.moveTo(cx, cy - 44);
  shield.lineTo(cx + 36, cy - 22);
  shield.lineTo(cx + 28, cy + 28);
  shield.lineTo(cx, cy + 48);
  shield.lineTo(cx - 28, cy + 28);
  shield.lineTo(cx - 36, cy - 22);
  shield.closePath();
  shield.fillPath();
  shield.strokePath();
  scene.tweens.add({
    targets: shield,
    alpha: 0,
    scaleX: 1.35,
    scaleY: 1.35,
    duration: 520,
    ease: 'Power2',
    onComplete: () => { if (shield.active) shield.destroy(); },
  });
  scene._showCombatText?.(cx, cy - 58, 'FORTIFY', '#93c5fd', '16px');
}

export function showPhaseStep(scene, { fromX, fromY, toX } = {}) {
  showBlink(scene, { fromX, fromY, toX, abilityKey: 'mage_phase_step', mode: 'phase_step' });
}

export function showSmokeVeil(scene, { fromX, fromY, toX, targetX, targetY, backstabReady = false } = {}) {
  showBlink(scene, {
    fromX,
    fromY,
    toX,
    targetX,
    targetY,
    abilityKey: 'rogue_smoke_veil',
    mode: 'smoke_veil',
    backstabReady,
  });
}

// ── Warrior: Guardbreak ───────────────────────────────────────────────────────
export function showGuardBreak(scene, { fromX, fromY, toX, toY, hit } = {}) {
  const asNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const impactX = asNumber(toX, asNumber(fromX, W / 2));
  const impactY = asNumber(toY, asNumber(fromY, FLOOR_Y)) - 34;

  const lbl = scene.add.text(impactX, impactY - 44, 'GUARD BREAK!', {
    fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold',
    color: '#facc15', stroke: '#020617', strokeThickness: 5,
  }).setOrigin(0.5).setDepth(13);
  scene.tweens.add({
    targets: lbl, y: impactY - 86, alpha: 0, scaleX: 1.12, scaleY: 1.12,
    duration: 680, ease: 'Power1', onComplete: () => { if (lbl.active) lbl.destroy(); },
  });

  const ring = scene.add.graphics().setDepth(9);
  ring.lineStyle(4, 0xfacc15, 0.95);
  ring.strokeCircle(impactX, impactY, 18);
  ring.lineStyle(2, 0x60a5fa, 0.85);
  ring.strokeCircle(impactX, impactY, 28);
  ring.lineStyle(3, 0xf8fafc, 0.9);
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    ring.beginPath();
    ring.moveTo(impactX + Math.cos(a) * 8, impactY + Math.sin(a) * 8);
    ring.lineTo(impactX + Math.cos(a) * 44, impactY + Math.sin(a) * 44);
    ring.strokePath();
  }
  scene.tweens.add({
    targets: ring, alpha: 0, scaleX: 2.4, scaleY: 2.4,
    duration: 380, ease: 'Power2', onComplete: () => { if (ring.active) ring.destroy(); },
  });

  const flash = scene.add.rectangle(W / 2, H / 2, W, H, 0xfacc15, 0.12).setDepth(7);
  scene.tweens.add({
    targets: flash, alpha: 0, duration: 220, ease: 'Power2',
    onComplete: () => { if (flash.active) flash.destroy(); },
  });

  if (scene.textures.exists('dust_particle')) {
    const burstCount = scene._isMobile ? 10 : 22;
    const burst = scene.add.particles(impactX, impactY, 'dust_particle', {
      speed: { min: 80, max: 210 }, angle: { min: 0, max: 360 },
      scale: { start: 0.75, end: 0 }, alpha: { start: 0.85, end: 0 },
      tint: [0xfacc15, 0x60a5fa, 0xf8fafc], lifespan: 340, quantity: burstCount, emitting: false,
    }).setDepth(8);
    burst.explode(burstCount);
    scene.time.delayedCall(430, () => { if (burst.active) burst.destroy(); });
  }

  if (!hit) scene._showCombatText?.(impactX, impactY - 8, 'MISS', '#94a3b8');
  scene.cameras?.main?.shake(hit ? 170 : 100, hit ? 0.011 : 0.005);
}

// ── Warrior: Bash ─────────────────────────────────────────────────────────────
export function showBash(scene, { x, y, hit = true, abilityKey = '' } = {}) {
  const variant = {
    warrior_titan_bash: { label: 'TITAN SLAM!', text: '#facc15', stroke: 0xfacc15, flash: 0xfacc15, sx: 14, sy: 7.0, shake: 0.014 },
    warrior_bash:    { label: 'CLEAVE!', text: '#f97316', stroke: 0xfb923c, flash: 0xf97316, sx: 8, sy: 3.4, shake: 0.006 },
    warrior_default: { label: 'BASH!', text: '#ff6600', stroke: 0xff4400, flash: 0xff4400, sx: 10, sy: 5, shake: 0.009 },
  }[abilityKey] || { label: 'BASH!', text: '#ff6600', stroke: 0xff4400, flash: 0xff4400, sx: 10, sy: 5, shake: 0.009 };
  const ring = scene.add.circle(x, y, 10, 0xff6600, 0).setDepth(8);
  ring.setStrokeStyle(3, hit ? variant.stroke : 0x886600);
  const lbl = scene.add.text(x, y - 60, variant.label, {
    fontSize: '20px', fontFamily: 'monospace', fontStyle: 'bold',
    color: variant.text, stroke: '#000', strokeThickness: 4,
  }).setOrigin(0.5).setDepth(13);
  scene.tweens.add({ targets: lbl, y: y - 100, alpha: 0, duration: 600, ease: 'Power1', onComplete: () => { if (lbl.active) lbl.destroy(); } });
  scene.tweens.add({
    targets: ring, scaleX: variant.sx, scaleY: variant.sy, alpha: 0,
    duration: 400, ease: 'Power2', onComplete: () => ring.destroy(),
  });
  if (abilityKey === 'warrior_bash') {
    const slash = scene.add.graphics().setDepth(9);
    slash.lineStyle(7, 0xf97316, 0.92);
    slash.beginPath();
    slash.moveTo(x - 46, y - 42);
    slash.lineTo(x + 48, y + 8);
    slash.strokePath();
    slash.lineStyle(3, 0xfef3c7, 0.88);
    slash.beginPath();
    slash.moveTo(x - 34, y - 50);
    slash.lineTo(x + 58, y - 2);
    slash.strokePath();
    scene.tweens.add({
      targets: slash,
      alpha: 0,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 280,
      ease: 'Power2',
      onComplete: () => { if (slash.active) slash.destroy(); },
    });
  }
  if (abilityKey === 'warrior_titan_bash') {
    const crack = scene.add.graphics().setDepth(9);
    crack.lineStyle(4, 0xfacc15, 0.9);
    for (let i = -2; i <= 2; i += 1) {
      const startX = x + i * 18;
      crack.beginPath();
      crack.moveTo(startX, y + 8);
      crack.lineTo(startX + i * 10, y + 34);
      crack.lineTo(startX + i * 18, y + 48);
      crack.strokePath();
    }
    scene.tweens.add({
      targets: crack,
      alpha: 0,
      scaleY: 1.25,
      duration: 420,
      ease: 'Power2',
      onComplete: () => { if (crack.active) crack.destroy(); },
    });
  }
  const flash = scene.add.rectangle(W / 2, H / 2, W, H, variant.flash, abilityKey === 'warrior_titan_bash' ? 0.16 : 0.1).setDepth(7);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 200, onComplete: () => flash.destroy() });
  scene._showCombatText?.(x, y - 34, hit ? 'HIT' : 'MISS', hit ? '#facc15' : '#94a3b8');
  if (hit) scene.cameras?.main?.shake(140, variant.shake);
}

// ── Mage: Fireball ────────────────────────────────────────────────────────────
export function showFireball(scene, { fromX, fromY, toX, toY, hit = true, abilityKey = '', blockedKnockback = false } = {}) {
  const variant = {
    mage_inferno_blast: { label: 'INFERNO!', color: '#fb7185', ball: 0xdc2626, core: 0xfef08a, tints: [0xdc2626, 0xfb7185, 0xfef08a], radius: 15, blast: 1.9, shake: 0.008 },
    mage_ember_bolt: { label: 'EMBER!', color: '#f97316', ball: 0xf97316, core: 0xffee00, tints: [0xf97316, 0xffaa00, 0xffee00], radius: 9, blast: 1.25, shake: 0.004 },
    mage_fireball: { label: 'FLARE!', color: '#fbbf24', ball: 0xf59e0b, core: 0xfef3c7, tints: [0xfbbf24, 0xf97316, 0xfef3c7], radius: 8, blast: 1.12, shake: 0.003 },
    mage_default: { label: 'FIREBALL!', color: '#ff4400', ball: 0xff4400, core: 0xffee00, tints: [0xff6600, 0xff2200, 0xffee00], radius: 11, blast: 1.5, shake: 0.005 },
  }[abilityKey] || { label: 'FIREBALL!', color: '#ff4400', ball: 0xff4400, core: 0xffee00, tints: [0xff6600, 0xff2200, 0xffee00], radius: 11, blast: 1.5, shake: 0.005 };
  const ball = scene.add.circle(fromX, fromY - 30, variant.radius, variant.ball).setDepth(9);
  const lbl = scene.add.text(fromX, fromY - 70, variant.label, {
    fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold',
    color: variant.color, stroke: '#000', strokeThickness: 4,
  }).setOrigin(0.5).setDepth(13);
  scene.tweens.add({ targets: lbl, y: fromY - 110, alpha: 0, duration: 600, ease: 'Power1', onComplete: () => { if (lbl.active) lbl.destroy(); } });
  const core = scene.add.circle(fromX, fromY - 30, 5, variant.core).setDepth(9);

  const trail = scene._isMobile ? null : (scene.textures.exists('fire_particle') ? scene.add.particles(fromX, fromY - 30, 'fire_particle', {
    speed: { min: 20, max: 60 }, angle: { min: 160, max: 200 },
    scale: { start: 1.0, end: 0 }, alpha: { start: 0.85, end: 0 },
    tint: variant.tints, lifespan: 180, quantity: 3, emitting: true,
  }).setDepth(8) : null);

  scene.tweens.add({
    targets: [ball, core], x: toX, y: toY - 30,
    duration: 320, ease: 'Linear',
    onUpdate: () => { if (ball.active && trail) trail.setPosition(ball.x, ball.y); },
    onComplete: () => {
      if (trail) trail.destroy();
      if (ball.active) ball.destroy();
      if (core.active) core.destroy();
      if (!scene.scene?.isActive()) return;

      if (scene.textures.exists('fire_particle')) {
        const blastCount = scene._isMobile ? (hit ? 6 : 3) : (hit ? 20 : 8);
        const blast = scene.add.particles(toX, toY - 30, 'fire_particle', {
          speed: { min: 80, max: 200 }, angle: { min: 0, max: 360 },
          scale: { start: variant.blast, end: 0 }, alpha: { start: 1, end: 0 },
          tint: variant.tints, lifespan: 320, quantity: blastCount, emitting: false,
        }).setDepth(9);
        blast.explode(blastCount);
        scene.time.delayedCall(400, () => { if (blast.active) blast.destroy(); });
      }

      if (hit) {
        const ring = scene.add.circle(toX, toY - 30, 8, variant.ball).setDepth(9);
        scene.tweens.add({
          targets: ring,
          scaleX: blockedKnockback ? 4 : 6,
          scaleY: blockedKnockback ? 4 : 6,
          alpha: 0,
          duration: 350,
          ease: 'Power2',
          onComplete: () => { if (ring.active) ring.destroy(); },
        });
        scene._showCombatText?.(
          toX,
          toY - 72,
          blockedKnockback ? 'GUARDED' : 'HIT',
          blockedKnockback ? '#93c5fd' : '#facc15',
        );
        scene.cameras?.main?.shake(90, blockedKnockback ? variant.shake * 0.45 : variant.shake);
      } else {
        scene._showCombatText?.(toX, toY - 72, 'DODGE', '#93c5fd');
      }
    },
  });
}

// ── Rogue: Blink ──────────────────────────────────────────────────────────────
export function showBlink(scene, {
  fromX,
  fromY,
  toX,
  targetX,
  targetY,
  mode = 'dash',
  backstabReady = false,
  abilityKey = '',
} = {}) {
  const variant = {
    mage_phase_step: { label: 'PHASE STEP!', color: '#93c5fd', fill: 0x60a5fa, tints: [0x60a5fa, 0x38bdf8, 0xdbeafe], qty: 14, scale: 1.45 },
    rogue_smoke_veil: { label: 'SMOKE VEIL!', color: '#cbd5e1', fill: 0x64748b, tints: [0x64748b, 0x0f172a, 0xe2e8f0], qty: 20, scale: 1.8 },
    rogue_nightfall: { label: 'AMBUSH!', color: '#f472b6', fill: 0xc026d3, tints: [0xc026d3, 0x581c87, 0xf0abfc], qty: 24, scale: 2.05 },
    rogue_shadowstep: { label: 'SHADOWSTEP!', color: '#38bdf8', fill: 0x38bdf8, tints: [0x38bdf8, 0x0f172a, 0xa5f3fc], qty: 16, scale: 1.6 },
    rogue_blink: { label: 'QUICKSTEP!', color: '#fb7185', fill: 0xfb7185, tints: [0xfb7185, 0xf43f5e, 0xfecdd3], qty: 10, scale: 1.2 },
    rogue_default: { label: 'BLINK!', color: '#00ffcc', fill: 0x00ffcc, tints: [0x00ffcc, 0x00ccaa, 0xaaffee], qty: 12, scale: 1.4 },
  }[abilityKey] || { label: 'BLINK!', color: '#00ffcc', fill: 0x00ffcc, tints: [0x00ffcc, 0x00ccaa, 0xaaffee], qty: 12, scale: 1.4 };
  const centerY = fromY - SPRITE_HEIGHT / 2;
  const arrivalLabel = backstabReady ? 'BACKSTAB READY' : mode === 'dash' ? 'DASH' : variant.label;
  const labelColor = backstabReady ? '#f472b6' : variant.color;
  const lbl = scene.add.text(toX, fromY - 70, arrivalLabel, {
    fontSize: backstabReady ? '17px' : '20px', fontFamily: 'monospace', fontStyle: 'bold',
    color: labelColor, stroke: '#000', strokeThickness: 4,
  }).setOrigin(0.5).setDepth(13);
  scene.tweens.add({ targets: lbl, y: fromY - 110, alpha: 0, duration: 600, ease: 'Power1', onComplete: () => { if (lbl.active) lbl.destroy(); } });

  const dashLine = scene.add.graphics().setDepth(6);
  dashLine.lineStyle(4, variant.fill, 0.45);
  dashLine.beginPath();
  dashLine.moveTo(fromX, centerY);
  dashLine.lineTo(toX, centerY);
  dashLine.strokePath();
  dashLine.lineStyle(1.5, 0xffffff, 0.42);
  dashLine.beginPath();
  dashLine.moveTo(fromX, centerY - 8);
  dashLine.lineTo(toX, centerY - 8);
  dashLine.strokePath();
  scene.tweens.add({
    targets: dashLine,
    alpha: 0,
    duration: 260,
    ease: 'Power2',
    onComplete: () => { if (dashLine.active) dashLine.destroy(); },
  });

  const hasSmoke = scene.textures.exists('smoke_particle');
  if (hasSmoke) {
    const depart = scene.add.particles(fromX, centerY, 'smoke_particle', {
      speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 },
      scale: { start: variant.scale, end: 0 }, alpha: { start: 0.7, end: 0 },
      tint: variant.tints, lifespan: 380, quantity: variant.qty, emitting: false,
    }).setDepth(6);
    depart.explode(variant.qty);
    scene.time.delayedCall(500, () => { if (depart.active) depart.destroy(); });
  }

  const ghost = scene.add.rectangle(fromX, centerY, 42, 72, variant.fill, 0.4).setDepth(6);
  scene.tweens.add({ targets: ghost, alpha: 0, scaleY: 0.3, duration: 240, ease: 'Power2', onComplete: () => { if (ghost.active) ghost.destroy(); } });

  scene.time.delayedCall(160, () => {
    if (!scene.scene?.isActive()) return;
    if (hasSmoke) {
      const arrive = scene.add.particles(toX, centerY, 'smoke_particle', {
        speed: { min: 40, max: 110 }, angle: { min: 0, max: 360 },
        scale: { start: variant.scale + 0.2, end: 0 }, alpha: { start: 0.85, end: 0 },
        tint: variant.tints, lifespan: 350, quantity: variant.qty + 4, emitting: false,
      }).setDepth(6);
      arrive.explode(variant.qty + 4);
      scene.time.delayedCall(450, () => { if (arrive.active) arrive.destroy(); });
    }
    const flash = scene.add.circle(toX, fromY - 30, 22, variant.fill, 0.8).setDepth(6);
    scene.tweens.add({ targets: flash, scaleX: 4.5, scaleY: 4.5, alpha: 0, duration: 320, ease: 'Power2', onComplete: () => { if (flash.active) flash.destroy(); } });

    if (abilityKey === 'rogue_blink' || abilityKey === 'rogue_nightfall') {
      const slash = scene.add.graphics().setDepth(10);
      slash.lineStyle(abilityKey === 'rogue_nightfall' ? 6 : 4, variant.fill, 0.92);
      slash.beginPath();
      slash.moveTo(toX - 28, fromY - 54);
      slash.lineTo(toX + 30, fromY - 18);
      slash.strokePath();
      slash.lineStyle(2, 0xffffff, 0.65);
      slash.beginPath();
      slash.moveTo(toX - 20, fromY - 62);
      slash.lineTo(toX + 38, fromY - 26);
      slash.strokePath();
      scene.tweens.add({
        targets: slash,
        alpha: 0,
        scaleX: abilityKey === 'rogue_nightfall' ? 1.55 : 1.25,
        scaleY: abilityKey === 'rogue_nightfall' ? 1.55 : 1.25,
        duration: abilityKey === 'rogue_nightfall' ? 420 : 280,
        ease: 'Power2',
        onComplete: () => { if (slash.active) slash.destroy(); },
      });
    }

    if (backstabReady && Number.isFinite(Number(targetX))) {
      const markX = Number(targetX);
      const markY = Number.isFinite(Number(targetY)) ? Number(targetY) - SPRITE_HEIGHT / 2 : centerY;
      const mark = scene.add.graphics().setDepth(10);
      mark.lineStyle(3, 0xf472b6, 0.95);
      mark.strokeCircle(markX, markY, 28);
      mark.lineStyle(2, 0xffffff, 0.75);
      mark.beginPath();
      mark.moveTo(markX - 18, markY - 8);
      mark.lineTo(markX + 18, markY + 8);
      mark.moveTo(markX + 18, markY - 8);
      mark.lineTo(markX - 18, markY + 8);
      mark.strokePath();
      scene.tweens.add({
        targets: mark,
        alpha: 0,
        scaleX: 1.7,
        scaleY: 1.7,
        duration: 420,
        ease: 'Power2',
        onComplete: () => { if (mark.active) mark.destroy(); },
      });
      scene._showCombatText?.(markX, markY - 36, 'BACKSTAB', '#f472b6', '15px');
    }
  });
}

// ── Warrior: Shield Dash ──────────────────────────────────────────────────────
export function showShieldDash(scene, { fromX, fromY, toX, toY, hit = true } = {}) {
  if (!scene || !scene.add) return;
  const isMobile = scene._isMobile?.();
  const particles = isMobile ? 8 : 16;

  // Departure burst — silver/blue shield energy
  for (let i = 0; i < particles; i++) {
    const angle = (Math.PI * 2 * i) / particles;
    const dist = 18 + Math.random() * 22;
    const px = fromX + Math.cos(angle) * dist;
    const py = fromY + Math.sin(angle) * dist;
    const p = scene.add.circle(fromX, fromY, 3 + Math.random() * 3, 0x93c5fd, 0.85).setDepth(6);
    scene.tweens.add({ targets: p, x: px, y: py, alpha: 0, scaleX: 0.3, scaleY: 0.3, duration: 240 + Math.random() * 80, ease: 'Power2', onComplete: () => { if (p.active) p.destroy(); } });
  }

  // Dash trail line
  const trailX = (fromX + toX) / 2;
  const trailY = (fromY + toY) / 2;
  const trail = scene.add.rectangle(trailX, trailY, Math.max(40, Math.abs(toX - fromX) * 0.7), 4, 0xbae6fd, 0.55).setDepth(5);
  scene.tweens.add({ targets: trail, alpha: 0, duration: 220, ease: 'Power2', onComplete: () => { if (trail.active) trail.destroy(); } });

  // Impact at target
  if (hit) {
    const ring = scene.add.circle(toX, toY, 14, 0x3b82f6, 0).setStrokeStyle(3, 0x93c5fd, 0.9).setDepth(6);
    scene.tweens.add({ targets: ring, scaleX: 3.5, scaleY: 3.5, alpha: 0, duration: 320, ease: 'Power2', onComplete: () => { if (ring.active) ring.destroy(); } });

    for (let i = 0; i < (isMobile ? 5 : 10); i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 35;
      const sp = scene.add.circle(toX, toY, 2 + Math.random() * 3, 0x60a5fa, 0.9).setDepth(6);
      scene.tweens.add({ targets: sp, x: toX + Math.cos(angle) * dist, y: toY + Math.sin(angle) * dist, alpha: 0, scaleX: 0.2, scaleY: 0.2, duration: 280 + Math.random() * 120, ease: 'Power2', onComplete: () => { if (sp.active) sp.destroy(); } });
    }

    scene._showCombatText?.(toX, toY - 64, 'SHIELD DASH!', '#93c5fd');
    scene.cameras?.main?.shake(80, 0.007);
  }
}

// ── Rogue: Execute ────────────────────────────────────────────────────────────
export function showExecute(scene, { fromX, fromY, toX, toY, hit = true, executed = false } = {}) {
  if (!scene || !scene.add) return;
  const isMobile = scene._isMobile?.();
  const particles = isMobile ? 8 : 18;

  // Dark energy burst at departure
  for (let i = 0; i < (isMobile ? 4 : 8); i++) {
    const angle = Math.random() * Math.PI * 2;
    const p = scene.add.circle(fromX, fromY, 2 + Math.random() * 3, 0xef4444, 0.8).setDepth(6);
    scene.tweens.add({ targets: p, x: fromX + Math.cos(angle) * (15 + Math.random() * 20), y: fromY + Math.sin(angle) * (15 + Math.random() * 20), alpha: 0, duration: 200, ease: 'Power3', onComplete: () => { if (p.active) p.destroy(); } });
  }

  // Fast dash slash line — red/dark
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const slash = scene.add.rectangle(midX, midY, Math.max(30, Math.abs(toX - fromX) * 0.8), 3, 0xef4444, 0.7).setDepth(6);
  scene.tweens.add({ targets: slash, alpha: 0, scaleY: 3, duration: 180, ease: 'Power2', onComplete: () => { if (slash.active) slash.destroy(); } });

  // Large impact burst at target
  if (hit) {
    // Main impact ring — dark crimson
    const ring = scene.add.circle(toX, toY, 12, 0x7f1d1d, 0).setStrokeStyle(4, 0xef4444, 0.95).setDepth(6);
    scene.tweens.add({ targets: ring, scaleX: 4, scaleY: 4, alpha: 0, duration: 350, ease: 'Power2', onComplete: () => { if (ring.active) ring.destroy(); } });

    // Second ring — faster, lighter
    const ring2 = scene.add.circle(toX, toY, 8, 0xfca5a5, 0).setStrokeStyle(2, 0xfca5a5, 0.7).setDepth(6);
    scene.tweens.add({ targets: ring2, scaleX: 6, scaleY: 6, alpha: 0, duration: 250, ease: 'Power3', onComplete: () => { if (ring2.active) ring2.destroy(); } });

    // Blood-red particles
    for (let i = 0; i < particles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 25 + Math.random() * 45;
      const sp = scene.add.circle(toX, toY, 2 + Math.random() * 4, i % 3 === 0 ? 0xfca5a5 : 0xef4444, 0.9).setDepth(6);
      scene.tweens.add({ targets: sp, x: toX + Math.cos(angle) * dist, y: toY + Math.sin(angle) * dist, alpha: 0, scaleX: 0.2, scaleY: 0.2, duration: 320 + Math.random() * 150, ease: 'Power2', onComplete: () => { if (sp.active) sp.destroy(); } });
    }

    // Dramatic X slash marks
    const slashColors = [0xef4444, 0xfca5a5];
    [[-1, -1], [1, -1]].forEach(([dx], idx) => {
      const s = scene.add.rectangle(toX + dx * 10, toY - 5, 18, 3, slashColors[idx], 0.9).setDepth(7);
      s.setRotation(dx * 0.6);
      scene.tweens.add({ targets: s, scaleX: 0.1, alpha: 0, duration: 280, delay: 30, ease: 'Power2', onComplete: () => { if (s.active) s.destroy(); } });
    });

    scene._showCombatText?.(toX, toY - 72, executed ? 'FINISHER!' : 'EXECUTE!', executed ? '#facc15' : '#ef4444', executed ? '22px' : '16px');
    scene.cameras?.main?.shake(executed ? 160 : 110, executed ? 0.018 : 0.011);
  }
}

// ── Mage: Frost Nova ──────────────────────────────────────────────────────────
export function showFrostNova(scene, { x, y, hit = true } = {}) {
  if (!scene || !scene.add) return;
  const isMobile = scene._isMobile?.();
  const particles = isMobile ? 10 : 20;

  // Expanding icy rings from caster position
  [0, 60, 120].forEach((delay) => {
    const ring = scene.add.circle(x, y, 10, 0x93c5fd, 0).setStrokeStyle(2, 0xbae6fd, 0.9).setDepth(6);
    scene.tweens.add({
      targets: ring,
      scaleX: 4.5, scaleY: 4.5, alpha: 0,
      duration: 480, delay,
      ease: 'Power2',
      onComplete: () => { if (ring.active) ring.destroy(); },
    });
  });

  // Ice crystal particles bursting outward
  for (let i = 0; i < particles; i++) {
    const angle = (Math.PI * 2 * i) / particles + (Math.random() - 0.5) * 0.4;
    const dist = 30 + Math.random() * 50;
    const size = 2 + Math.random() * 3;
    const color = [0x93c5fd, 0xbae6fd, 0xe0f2fe][Math.floor(Math.random() * 3)];
    const p = scene.add.rectangle(x, y, size, size * 2, color, 0.9).setDepth(6);
    p.setRotation(angle);
    scene.tweens.add({
      targets: p,
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0, scaleX: 0.2, scaleY: 0.2,
      duration: 400 + Math.random() * 150,
      ease: 'Power2',
      onComplete: () => { if (p.active) p.destroy(); },
    });
  }

  if (hit) {
    scene._showCombatText?.(x, y - 70, 'FROST NOVA!', '#93c5fd');
    scene.cameras?.main?.shake(70, 0.005);
  }
}
