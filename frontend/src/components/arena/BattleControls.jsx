import React, { useCallback, useRef, useState } from 'react';
import battleAbilities from '../../generated/battle_abilities.json';
import { resolveAbilityDamage } from '../../utils/itemPresentation';
import {
  CLASS_ABILITY_ICONS,
  CLASS_COOLDOWNS,
  CLASS_DEFAULT_ABILITY_KEYS,
} from '../../utils/battleSkills';

// Re-export everything from battleSkills for consumers (e.g. BossRaidScreen)
// NOTE: utility slot is now purchasable — CLASS_UTILITY_ABILITY_KEYS / UTILITY_COOLDOWNS
// are kept in battleSkills.js for BossRaidScreen but are no longer used here.
export {
  CLASS_ABILITY_ICONS,
  CLASS_COOLDOWNS,
  CLASS_DEFAULT_ABILITY_KEYS,
  CLASS_UTILITY_ABILITY_KEYS,
  CLASS_UTILITY_ICONS,
  UTILITY_COOLDOWNS,
} from '../../utils/battleSkills';

// ── Shared constants ──────────────────────────────────────────────────────────
const ABILITY_DATA = battleAbilities?.abilities || {};

export const ABILITY_NAMES = Object.fromEntries(
  Object.entries(CLASS_DEFAULT_ABILITY_KEYS).map(([classKey, abilityKey]) => [
    classKey,
    ABILITY_DATA[abilityKey]?.label || 'Ability',
  ])
);

// Mobile-MOBA control sizing (Wild Rift / Mobile Legends style): big basic-attack
// button anchored bottom-right, skill buttons fanned on an arc up-and-left of it,
// movement joystick bottom-left. Skill positions are computed on the arc at render
// time (see BattleControlsOverlay) — no per-button hand-tuned offsets.
//
// arcGap must be large enough that skill edges don't overlap.
// With ability=64 and 30 deg spacing: chord = 2*(r+ability/2+arcGap)*sin(15 deg).
// chord >= ability+8 (8 px gap) → arcGap >= 56 for regular, 44 for compact.
export const BATTLE_CONTROL_LAYOUTS = {
  regular: {
    joystick: 138,
    joystickKnob: 56,
    joystickEdge: 20,
    clusterWidth: 278,
    clusterHeight: 236,
    clusterRight: 16,
    clusterBottom: 18,
    attack: 92,
    attackFont: 34,
    ability: 64,       // uniform size for all skill buttons
    block: 56,
    blockFont: 22,
    arcGap: 58,        // keeps skill edges ~8 px apart at 30 deg spacing
  },
  compact: {
    joystick: 110,
    joystickKnob: 44,
    joystickEdge: 14,
    clusterWidth: 222,
    clusterHeight: 192,
    clusterRight: 10,
    clusterBottom: 10,
    attack: 76,
    attackFont: 28,
    ability: 54,
    block: 46,
    blockFont: 18,
    arcGap: 46,        // keeps skill edges ~8 px apart at 30 deg spacing
  },
};

function getBattleControlLayout() {
  if (typeof window === 'undefined') return BATTLE_CONTROL_LAYOUTS.regular;
  const minViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  const compact = Boolean(window.Telegram?.WebApp) || minViewport <= 520;
  return compact ? BATTLE_CONTROL_LAYOUTS.compact : BATTLE_CONTROL_LAYOUTS.regular;
}

function useBattleControlLayout() {
  const [layout, setLayout] = React.useState(getBattleControlLayout);
  React.useEffect(() => {
    const update = () => setLayout(getBattleControlLayout());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return layout;
}

function abilityTooltip(name, cooldownMs, stats, abilityBonus = 0) {
  const parts = [`${name} - ${Math.round(cooldownMs / 1000)}s cooldown`];
  const damage = Number(stats?.damage || 0);
  if (damage) {
    parts.push(`${resolveAbilityDamage(damage, abilityBonus, Number(stats?.ability_power_scale ?? 1))} DMG`);
  }
  if (stats?.stun_ms) parts.push(`${String(Number(stats.stun_ms) / 1000).replace(/\.0$/, '')}s stun`);
  if (stats?.range) parts.push(`${Math.round(Number(stats.range))} range`);
  if (stats?.knockback) parts.push(`${Math.round(Number(stats.knockback))} knockback`);
  if (stats?.offset) parts.push(`${Math.round(Number(stats.offset))} reposition`);
  if (stats?.guard_restore) parts.push(`${Math.round(Number(stats.guard_restore))} guard`);
  if (stats?.backstab_window_ms) parts.push(`${String(Number(stats.backstab_window_ms) / 1000).replace(/\.0$/, '')}s ambush`);
  return parts.join(' | ');
}

// ── Joystick — left / right / up ─────────────────────────────────────────────
export function JoystickControl({
  onChange,
  size = BATTLE_CONTROL_LAYOUTS.regular.joystick,
  knobSize = BATTLE_CONTROL_LAYOUTS.regular.joystickKnob,
}) {
  const baseRef      = useRef(null);
  const pointerIdRef = useRef(null);
  const currentRef   = useRef({ left: false, right: false, up: false });
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const applyPointer = useCallback((clientX, clientY) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius      = rect.width / 2;
    const maxDistance = radius - Math.max(14, knobSize / 3);
    const dx       = clientX - (rect.left + radius);
    const dy       = clientY - (rect.top  + radius);
    const distance = Math.min(Math.hypot(dx, dy), maxDistance);
    const angle    = Math.atan2(dy, dx);
    const x        = Math.cos(angle) * distance;
    const y        = Math.sin(angle) * distance;
    const threshold = Math.max(14, rect.width * 0.14);
    const next     = { left: x < -threshold, right: x > threshold, up: y < -threshold };
    setKnob({ x, y });
    if (
      next.left  !== currentRef.current.left  ||
      next.right !== currentRef.current.right ||
      next.up    !== currentRef.current.up
    ) {
      currentRef.current = next;
      onChange(next);
    }
  }, [onChange]);

  const reset = useCallback(() => {
    const neutral = { left: false, right: false, up: false };
    pointerIdRef.current = null;
    setKnob({ x: 0, y: 0 });
    currentRef.current = neutral;
    onChange(neutral);
  }, [onChange]);

  return (
    <div
      ref={baseRef}
      onPointerDown={(e) => {
        e.preventDefault();
        pointerIdRef.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        applyPointer(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pointerIdRef.current !== e.pointerId) return;
        e.preventDefault();
        applyPointer(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (pointerIdRef.current !== e.pointerId) return;
        e.preventDefault();
        reset();
      }}
      onPointerCancel={(e) => {
        if (pointerIdRef.current !== e.pointerId) return;
        e.preventDefault();
        reset();
      }}
      style={{
        width: size, height: size, borderRadius: '50%',
        position: 'relative', touchAction: 'none',
        userSelect: 'none', WebkitUserSelect: 'none',
        background: 'radial-gradient(circle, rgba(50,72,112,0.78) 0%, rgba(15,23,42,0.86) 64%, rgba(2,6,23,0.92) 100%)',
        border: '2px solid rgba(148,163,184,0.22)',
        boxShadow: 'inset 0 0 24px rgba(0,0,0,0.42), 0 4px 14px rgba(0,0,0,0.5)',
      }}
      aria-label="Movement joystick"
    >
      <div style={{ position:'absolute', left:'50%', top:Math.max(8, size * 0.09), transform:'translateX(-50%)', color:'rgba(226,232,240,0.72)', fontSize:Math.max(14, size * 0.14), fontWeight:900, pointerEvents:'none' }}>↑</div>
      <div style={{ position:'absolute', left:Math.max(8, size * 0.09), top:'50%', transform:'translateY(-50%)', color:'rgba(226,232,240,0.72)', fontSize:Math.max(14, size * 0.14), fontWeight:900, pointerEvents:'none' }}>←</div>
      <div style={{ position:'absolute', right:Math.max(8, size * 0.09), top:'50%', transform:'translateY(-50%)', color:'rgba(226,232,240,0.72)', fontSize:Math.max(14, size * 0.14), fontWeight:900, pointerEvents:'none' }}>→</div>
      <div style={{
        position:'absolute', left:'50%', top:'50%',
        width:knobSize, height:knobSize, borderRadius:'50%',
        transform:`translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
        background:'linear-gradient(180deg, rgba(226,232,240,0.94), rgba(100,116,139,0.9))',
        border:'2px solid rgba(255,255,255,0.35)',
        boxShadow:'0 8px 18px rgba(0,0,0,0.45)',
        pointerEvents:'none',
      }} />
    </div>
  );
}

// ── Touch button ──────────────────────────────────────────────────────────────
export function TouchButton({ label, color, onDown, onUp, style = {}, title = '' }) {
  return (
    <div
      onPointerDown={(e) => { e.preventDefault(); onDown(); }}
      onPointerUp={(e) => { e.preventDefault(); onUp(); }}
      onPointerLeave={(e) => { e.preventDefault(); onUp(); }}
      onPointerCancel={(e) => { e.preventDefault(); onUp(); }}
      style={{
        userSelect:'none', WebkitUserSelect:'none', touchAction:'none',
        width:64, height:64, borderRadius:'50%',
        background: color,
        border:'2px solid rgba(255,255,255,0.18)',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:24, color:'white', fontWeight:900,
        boxShadow:'0 4px 14px rgba(0,0,0,0.5)',
        cursor:'pointer',
        ...style,
      }}
      title={title}
      aria-label={title || String(label)}
    >
      {label}
    </div>
  );
}

// ── Ability button with SVG circular cooldown arc ─────────────────────────────
export function AbilityButton({
  abilityReady,
  playerClass,
  equippedAbility,
  onActivate,
  cooldownUntil = 0,
  size = 64,
  style = {},
}) {
  const [progress, setProgress] = React.useState(0);
  const [readyPulse, setReadyPulse] = React.useState(false);
  const rafRef   = React.useRef(null);
  const startRef = React.useRef(null);
  const wasCoolingDownRef = React.useRef(false);

  const abilityName = equippedAbility?.name || ABILITY_NAMES[playerClass] || 'Ability';
  const imagePath   = equippedAbility?.image_path || '';
  const abilityKey  = equippedAbility?.ability_key || CLASS_DEFAULT_ABILITY_KEYS[playerClass] || '';
  const abilityStats = equippedAbility?.battle_stats || equippedAbility?.active_ability_stats || ABILITY_DATA[abilityKey] || null;
  const abilityBonus = Number(equippedAbility?.ability_bonus || equippedAbility?.effective_stats?.ability_bonus || 0);
  const hasAbility  = Boolean(abilityKey || equippedAbility?.name);
  const canActivate = hasAbility && abilityReady;
  const cooldownMs  = Number(
    equippedAbility?.ability_cooldown_ms ||
    equippedAbility?.cooldown_ms         ||
    ABILITY_DATA[abilityKey]?.cooldown_ms ||
    CLASS_COOLDOWNS[playerClass]         ||
    6000
  );
  const cooldownText = hasAbility
    ? abilityTooltip(abilityName, cooldownMs, abilityStats, abilityBonus)
    : 'Equip an ability item';

  React.useEffect(() => {
    if (!abilityReady) {
      wasCoolingDownRef.current = true;
      startRef.current = Date.now();
      setProgress(0);
      const tick = () => {
        const now = Date.now();
        const serverUntil = Number(cooldownUntil || 0);
        const p = serverUntil > now
          ? Math.min(Math.max(1 - ((serverUntil - now) / cooldownMs), 0), 1)
          : Math.min((now - startRef.current) / cooldownMs, 1);
        setProgress(p);
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
      if (wasCoolingDownRef.current && hasAbility) {
        wasCoolingDownRef.current = false;
        setReadyPulse(true);
        const id = setTimeout(() => setReadyPulse(false), 620);
        return () => clearTimeout(id);
      }
    }
  }, [abilityReady, cooldownMs, cooldownUntil, hasAbility]);

  const r                = 27;
  const circ             = 2 * Math.PI * r;
  const dash             = circ * progress;
  const iconSize         = Math.max(30, Math.round(size * 0.6));
  const fontSize         = Math.max(16, Math.round(size * 0.31));
  const remainingSeconds = Math.max(1, Math.ceil(((1 - progress) * cooldownMs) / 1000));

  return (
    <div
      onPointerDown={(e) => { e.preventDefault(); if (canActivate) onActivate(); }}
      onPointerUp={(e) => e.preventDefault()}
      onPointerLeave={(e) => e.preventDefault()}
      onPointerCancel={(e) => e.preventDefault()}
      style={{
        position:'relative', width:size, height:size,
        touchAction:'none', userSelect:'none', WebkitUserSelect:'none',
        cursor: canActivate ? 'pointer' : 'default',
        flexShrink: 0,
        ...style,
      }}
      title={cooldownText}
      aria-label={cooldownText}
    >
      {/* SVG ring */}
      <svg
        width={size} height={size}
        style={{ position:'absolute', top:0, left:0, transform:'rotate(-90deg)', pointerEvents:'none' }}
        viewBox="0 0 64 64"
      >
        <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={5} />
        {hasAbility && !abilityReady && (
          <circle cx={32} cy={32} r={r} fill="none"
            stroke="rgba(147,51,234,0.85)" strokeWidth={5}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          />
        )}
        {canActivate && (
          <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(196,105,255,0.55)" strokeWidth={5} />
        )}
        {readyPulse && (
          <circle cx={32} cy={32} r={r - 2} fill="none"
            stroke="rgba(250,204,21,0.95)" strokeWidth={4}
            strokeDasharray={`${circ * 0.72} ${circ}`} strokeLinecap="round"
          />
        )}
      </svg>

      {readyPulse && (
        <div style={{
          position:'absolute', inset:-8, borderRadius:'50%',
          border:'2px solid rgba(250,204,21,0.9)',
          boxShadow:'0 0 20px rgba(250,204,21,0.65)',
          animation:'riskarenaAbilityReadyPulse 0.62s ease-out forwards',
          pointerEvents:'none',
        }} />
      )}

      {/* Inner circle */}
      <div style={{
        position:'absolute', inset:5, borderRadius:'50%',
        background: canActivate ? 'rgba(147,51,234,0.88)' : 'rgba(40,40,55,0.75)',
        border:'2px solid rgba(255,255,255,0.18)',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:22, color:'white', fontWeight:900,
        boxShadow: canActivate
          ? readyPulse
            ? '0 0 22px rgba(250,204,21,0.82), 0 0 14px rgba(147,51,234,0.72), 0 4px 14px rgba(0,0,0,0.5)'
            : '0 0 12px rgba(147,51,234,0.6), 0 4px 14px rgba(0,0,0,0.5)'
          : '0 4px 14px rgba(0,0,0,0.5)',
        opacity: canActivate ? 1 : 0.55,
        transition:'background 0.25s, opacity 0.25s, box-shadow 0.25s',
      }}>
        <span style={{ position:'relative', zIndex:2, fontSize, lineHeight:1, textShadow:'0 2px 6px rgba(0,0,0,0.85)' }}>
          {!hasAbility ? '-' : abilityReady ? abilityName.slice(0,1).toUpperCase() : remainingSeconds}
        </span>
        {imagePath && (
          <img
            src={imagePath} alt="" draggable={false}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{
              position:'absolute', width:iconSize, height:iconSize,
              objectFit:'contain',
              filter: canActivate ? 'drop-shadow(0 0 6px rgba(255,255,255,0.28))' : 'grayscale(1)',
              opacity: abilityReady ? 1 : 0.38,
              pointerEvents:'none',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Full battle controls overlay ──────────────────────────────────────────────
//
// Drop inside any position:relative container. Controls are absolutely
// positioned inside it — joystick bottom-left, buttons bottom-right.
//
// Props:
//   playerClass            — 'warrior' | 'mage' | 'rogue'
//   abilityReady           — bool, class ability ready state
//   itemAbilityReady       — bool, item ability (slot 1, unlocks Lv5) ready state
//   itemAbility2Ready      — bool, item ability (slot 2, unlocks Lv3) ready state
//   equippedAbility        — object | null  (ability slot from /me/equipped, Lv5+)
//   equippedAbility2       — object | null  (ability_2 slot from /me/equipped, Lv3+)
//   userLevel              — number (user's current level, for slot gating)
//   canAttack              — bool
//   showBlock              — bool (default true — Arena uses it, BossRaid skips it)
//   onJoystick(input)      — {left, right, up}
//   onAttack()
//   onAbility()
//   onItemAbility()
//   onItemAbility2()
//   onBlockDown()          — optional, only needed when showBlock=true
//   onBlockUp()            — optional
//
export function BattleControlsOverlay({
  playerClass           = 'warrior',
  abilityReady          = true,
  itemAbilityReady      = true,
  itemAbility2Ready     = true,
  abilityCooldownUntil  = 0,
  itemAbilityCooldownUntil  = 0,
  itemAbility2CooldownUntil = 0,
  equippedAbility       = null,
  equippedAbility2      = null,
  userLevel             = 1,
  canAttack             = true,
  showBlock             = true,
  onJoystick,
  onAttack,
  onAbility        = () => {},
  onItemAbility    = () => {},
  onItemAbility2   = () => {},
  onBlockDown,
  onBlockUp,
}) {
  const layout = useBattleControlLayout();
  // Reset controls ONLY on unmount. Keeping onJoystick/onBlockUp in the deps made the
  // cleanup re-run on every parent render where those callbacks have a new identity
  // (BossRaidScreen passes inline onBlockUp) — which neutralised a held joystick every
  // frame, so movement kept stopping. Refs let the unmount cleanup call the latest fns.
  const onJoystickRef    = React.useRef(onJoystick);
  const onBlockUpRef     = React.useRef(onBlockUp);
  const onItemAbility2Ref = React.useRef(onItemAbility2);
  onJoystickRef.current    = onJoystick;
  onBlockUpRef.current     = onBlockUp;
  onItemAbility2Ref.current = onItemAbility2;
  React.useEffect(() => () => {
    onJoystickRef.current?.({ left: false, right: false, up: false });
    onBlockUpRef.current?.();
  }, []);

  return (
    <div style={{ position:'absolute', inset:0, zIndex:20, pointerEvents:'none' }}>
      <style>{`
        @keyframes riskarenaAbilityReadyPulse {
          0% { transform: scale(0.86); opacity: 0.95; }
          100% { transform: scale(1.32); opacity: 0; }
        }
      `}</style>

      {/* Joystick — bottom left */}
      <div style={{
        position:'absolute',
        left:`max(${layout.joystickEdge}px, env(safe-area-inset-left))`,
        bottom:`max(${layout.joystickEdge}px, env(safe-area-inset-bottom))`,
        pointerEvents:'auto',
      }}>
        <JoystickControl
          onChange={onJoystick}
          size={layout.joystick}
          knobSize={layout.joystickKnob}
        />
      </div>

      {/* Right cluster — MOBA layout: big attack bottom-right, skills fanned on an arc */}
      <div style={{
        position:'absolute',
        right:`max(${layout.clusterRight}px, env(safe-area-inset-right))`,
        bottom:`max(${layout.clusterBottom}px, env(safe-area-inset-bottom))`,
        width:layout.clusterWidth, height:layout.clusterHeight,
        pointerEvents:'none',
      }}>
        {(() => {
          const aSize = layout.ability;
          const r = layout.attack / 2;                 // attack radius
          const arcR = r + aSize / 2 + layout.arcGap;  // attack centre → skill centre

          // Skills shown, in arc order (nearest-to-left first → top last).
          // Slot 2 (ability_2) unlocks at Lv3; Slot 1 (ability/item) unlocks at Lv5.
          // Both slots are always shown — level gate controls appearance, not presence.
          const skills = [
            {
              key: 'class',
              node: (
                <AbilityButton
                  abilityReady={abilityReady}
                  playerClass={playerClass}
                  cooldownUntil={abilityCooldownUntil}
                  size={aSize}
                  equippedAbility={{
                    name: ABILITY_NAMES[playerClass] || 'Ability',
                    image_path: CLASS_ABILITY_ICONS[playerClass],
                    ability_key: CLASS_DEFAULT_ABILITY_KEYS[playerClass],
                  }}
                  onActivate={onAbility}
                />
              ),
            },
            {
              key: 'ability_2',
              node: userLevel >= 3 ? (
                equippedAbility2 ? (
                  <AbilityButton
                    abilityReady={itemAbility2Ready}
                    playerClass={playerClass}
                    cooldownUntil={itemAbility2CooldownUntil}
                    size={aSize}
                    equippedAbility={equippedAbility2}
                    onActivate={onItemAbility2}
                  />
                ) : (
                  <div style={{ width: aSize, height: aSize, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: '1.5px dashed rgba(255,255,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.7, touchAction: 'none', userSelect: 'none' }}>
                    <span style={{ fontSize: Math.round(aSize * 0.3), color: 'rgba(255,255,255,0.35)' }}>+</span>
                  </div>
                )
              ) : (
                <div style={{ width: aSize, height: aSize, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: '1.5px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.55, touchAction: 'none', userSelect: 'none' }}>
                  <span style={{ fontSize: Math.round(aSize * 0.35), lineHeight: 1 }}>🔒</span>
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', fontWeight: 900, marginTop: 1 }}>Lv3</span>
                </div>
              ),
            },
            {
              key: 'item',
              node: userLevel >= 5 ? (
                equippedAbility ? (
                  <AbilityButton
                    abilityReady={itemAbilityReady}
                    playerClass={playerClass}
                    cooldownUntil={itemAbilityCooldownUntil}
                    size={aSize}
                    equippedAbility={equippedAbility}
                    onActivate={onItemAbility}
                  />
                ) : (
                  <div style={{ width: aSize, height: aSize, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: '1.5px dashed rgba(255,255,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.7, touchAction: 'none', userSelect: 'none' }}>
                    <span style={{ fontSize: Math.round(aSize * 0.3), color: 'rgba(255,255,255,0.35)' }}>+</span>
                  </div>
                )
              ) : (
                <div style={{ width: aSize, height: aSize, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: '1.5px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.55, touchAction: 'none', userSelect: 'none' }}>
                  <span style={{ fontSize: Math.round(aSize * 0.35), lineHeight: 1 }}>🔒</span>
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', fontWeight: 900, marginTop: 1 }}>Lv5</span>
                </div>
              ),
            },
          ];

          // Arc spans from ~upper-left to ~left around the attack centre.
          // Angles in degrees CCW from +x axis: 180=left, 90=up.
          // Spread: 60 deg (block mode) / 84 deg (no-block), giving ~30 deg per slot.
          // Wide spread + large arcGap keep skill edges from overlapping.
          const N = skills.length;
          const aStart = showBlock ? 148 : 172;
          const aEnd = 88;
          const angleAt = (i) => (N <= 1 ? 130 : aStart + ((aEnd - aStart) * i) / (N - 1));

          return (
            <>
              {/* Basic attack — bottom-right corner */}
              <TouchButton
                label="⚔️"
                title="Attack"
                color="radial-gradient(circle at 35% 28%, rgba(248,113,113,0.96), rgba(127,29,29,0.92) 68%, rgba(69,10,10,0.96))"
                onDown={canAttack ? onAttack : () => {}}
                onUp={() => {}}
                style={{
                  position:'absolute', right:0, bottom:0,
                  width:layout.attack, height:layout.attack, fontSize:layout.attackFont,
                  pointerEvents: canAttack ? 'auto' : 'none',
                  border:'3px solid rgba(254,202,202,0.3)',
                  boxShadow:'0 0 22px rgba(220,38,38,0.42), 0 10px 24px rgba(0,0,0,0.55)',
                  opacity: canAttack ? 1 : 0.4,
                }}
              />

              {/* Block — lower-left of attack (Arena only) */}
              {showBlock && (
                <TouchButton
                  label="🛡"
                  title="Block"
                  color="radial-gradient(circle at 35% 25%, rgba(96,165,250,0.96), rgba(30,64,175,0.9) 68%, rgba(15,23,42,0.95))"
                  onDown={onBlockDown || (() => {})}
                  onUp={onBlockUp || (() => {})}
                  style={{
                    position:'absolute', right:layout.attack + 8, bottom:4,
                    width:layout.block, height:layout.block, fontSize:layout.blockFont,
                    pointerEvents:'auto',
                  }}
                />
              )}

              {/* Skills — fanned on the arc */}
              {skills.map((s, i) => {
                const ang = (angleAt(i) * Math.PI) / 180;
                const cx = r - arcR * Math.cos(ang); // distance from cluster right edge to skill centre
                const cy = r + arcR * Math.sin(ang); // distance from cluster bottom edge to skill centre
                return s.node ? (
                  <div
                    key={s.key}
                    style={{ position:'absolute', right: cx - aSize / 2, bottom: cy - aSize / 2, pointerEvents:'auto' }}
                  >
                    {s.node}
                  </div>
                ) : null;
              })}
            </>
          );
        })()}
      </div>

    </div>
  );
}
