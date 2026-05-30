import React, { useCallback, useRef, useState } from 'react';

// ── Shared constants ──────────────────────────────────────────────────────────
export const CLASS_COOLDOWNS = { warrior: 8000, mage: 6000, rogue: 5000 };

export const ABILITY_NAMES = { warrior: 'Bash', mage: 'Fireball', rogue: 'Blink' };

export const CLASS_ABILITY_ICONS = {
  warrior: '/items/skills/class_bash.png',
  mage:    '/items/skills/class_fireball.png',
  rogue:   '/items/skills/class_blink.png',
};

// ── Joystick — left / right / up ─────────────────────────────────────────────
export function JoystickControl({ onChange }) {
  const baseRef      = useRef(null);
  const pointerIdRef = useRef(null);
  const currentRef   = useRef({ left: false, right: false, up: false });
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const applyPointer = useCallback((clientX, clientY) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius      = rect.width / 2;
    const maxDistance = radius - 18;
    const dx       = clientX - (rect.left + radius);
    const dy       = clientY - (rect.top  + radius);
    const distance = Math.min(Math.hypot(dx, dy), maxDistance);
    const angle    = Math.atan2(dy, dx);
    const x        = Math.cos(angle) * distance;
    const y        = Math.sin(angle) * distance;
    const next     = { left: x < -18, right: x > 18, up: y < -20 };
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
        width: 132, height: 132, borderRadius: '50%',
        position: 'relative', touchAction: 'none',
        userSelect: 'none', WebkitUserSelect: 'none',
        background: 'radial-gradient(circle, rgba(50,72,112,0.78) 0%, rgba(15,23,42,0.86) 64%, rgba(2,6,23,0.92) 100%)',
        border: '2px solid rgba(148,163,184,0.22)',
        boxShadow: 'inset 0 0 24px rgba(0,0,0,0.42), 0 4px 14px rgba(0,0,0,0.5)',
      }}
      aria-label="Movement joystick"
    >
      <div style={{ position:'absolute', left:'50%', top:12, transform:'translateX(-50%)', color:'rgba(226,232,240,0.72)', fontSize:18, fontWeight:900, pointerEvents:'none' }}>↑</div>
      <div style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'rgba(226,232,240,0.72)', fontSize:18, fontWeight:900, pointerEvents:'none' }}>←</div>
      <div style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', color:'rgba(226,232,240,0.72)', fontSize:18, fontWeight:900, pointerEvents:'none' }}>→</div>
      <div style={{
        position:'absolute', left:'50%', top:'50%',
        width:54, height:54, borderRadius:'50%',
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
  size = 64,
  style = {},
}) {
  const [progress, setProgress] = React.useState(0);
  const rafRef   = React.useRef(null);
  const startRef = React.useRef(null);

  const abilityName = equippedAbility?.name || ABILITY_NAMES[playerClass] || 'Ability';
  const imagePath   = equippedAbility?.image_path || '';
  const hasAbility  = Boolean(equippedAbility?.ability_key || equippedAbility?.name);
  const canActivate = hasAbility && abilityReady;
  const cooldownMs  = Number(
    equippedAbility?.ability_cooldown_ms ||
    equippedAbility?.cooldown_ms         ||
    CLASS_COOLDOWNS[playerClass]         ||
    6000
  );
  const cooldownText = hasAbility
    ? `${abilityName} — ${Math.round(cooldownMs / 1000)}s cooldown`
    : 'Equip an ability item';

  React.useEffect(() => {
    if (!abilityReady) {
      startRef.current = Date.now();
      setProgress(0);
      const tick = () => {
        const p = Math.min((Date.now() - startRef.current) / cooldownMs, 1);
        setProgress(p);
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress(0);
    }
  }, [abilityReady, cooldownMs]);

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
      </svg>

      {/* Inner circle */}
      <div style={{
        position:'absolute', inset:5, borderRadius:'50%',
        background: canActivate ? 'rgba(147,51,234,0.88)' : 'rgba(40,40,55,0.75)',
        border:'2px solid rgba(255,255,255,0.18)',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:22, color:'white', fontWeight:900,
        boxShadow: canActivate
          ? '0 0 12px rgba(147,51,234,0.6), 0 4px 14px rgba(0,0,0,0.5)'
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
//   playerClass       — 'warrior' | 'mage' | 'rogue'
//   abilityReady      — bool, class ability ready state
//   itemAbilityReady  — bool, item ability ready state
//   equippedAbility   — object | null  (the ability item from /me/equipped)
//   canAttack         — bool
//   showBlock         — bool (default true — Arena uses it, BossRaid skips it)
//   onJoystick(input) — {left, right, up}
//   onAttack()
//   onAbility()
//   onItemAbility()
//   onBlockDown()     — optional, only needed when showBlock=true
//   onBlockUp()       — optional
//
export function BattleControlsOverlay({
  playerClass      = 'warrior',
  abilityReady     = true,
  itemAbilityReady = true,
  equippedAbility  = null,
  canAttack        = true,
  showBlock        = true,
  onJoystick,
  onAttack,
  onAbility,
  onItemAbility,
  onBlockDown,
  onBlockUp,
}) {
  return (
    <div style={{ position:'absolute', inset:0, zIndex:20, pointerEvents:'none' }}>

      {/* Joystick — bottom left */}
      <div style={{
        position:'absolute',
        left:'max(18px, env(safe-area-inset-left))',
        bottom:'max(18px, env(safe-area-inset-bottom))',
        pointerEvents:'auto',
      }}>
        <JoystickControl onChange={onJoystick} />
      </div>

      {/* Right cluster — 214 × 178 */}
      <div style={{
        position:'absolute',
        right:'max(22px, env(safe-area-inset-right))',
        bottom:'max(20px, env(safe-area-inset-bottom))',
        width:214, height:178,
        pointerEvents:'none',
      }}>
        {/* Attack — bottom-right corner, 92×92 */}
        <TouchButton
          label="⚔️"
          title="Attack"
          color="radial-gradient(circle at 35% 28%, rgba(248,113,113,0.96), rgba(127,29,29,0.92) 68%, rgba(69,10,10,0.96))"
          onDown={canAttack ? onAttack : () => {}}
          onUp={() => {}}
          style={{
            position:'absolute', right:0, bottom:0,
            width:92, height:92, fontSize:34,
            pointerEvents: canAttack ? 'auto' : 'none',
            border:'3px solid rgba(254,202,202,0.3)',
            boxShadow:'0 0 22px rgba(220,38,38,0.42), 0 10px 24px rgba(0,0,0,0.55)',
            opacity: canAttack ? 1 : 0.4,
          }}
        />

        {/* Block — only in Arena */}
        {showBlock && (
          <TouchButton
            label="B"
            title="Block"
            color="radial-gradient(circle at 35% 25%, rgba(96,165,250,0.96), rgba(30,64,175,0.9) 68%, rgba(15,23,42,0.95))"
            onDown={onBlockDown || (() => {})}
            onUp={onBlockUp   || (() => {})}
            style={{
              position:'absolute', right:80, bottom:20,
              width:62, height:62, fontSize:22,
              pointerEvents:'auto',
            }}
          />
        )}

        {/* Class ability — always shown */}
        <AbilityButton
          abilityReady={abilityReady}
          playerClass={playerClass}
          size={66}
          style={{ position:'absolute', right:24, bottom:98, pointerEvents:'auto' }}
          equippedAbility={{ name: ABILITY_NAMES[playerClass] || 'Ability', image_path: CLASS_ABILITY_ICONS[playerClass] }}
          onActivate={onAbility}
        />

        {/* Item ability — only when ability item is equipped */}
        {equippedAbility && (
          <AbilityButton
            abilityReady={itemAbilityReady}
            playerClass={playerClass}
            size={62}
            style={{ position:'absolute', right:100, bottom:94, pointerEvents:'auto' }}
            equippedAbility={equippedAbility}
            onActivate={onItemAbility}
          />
        )}
      </div>

    </div>
  );
}
