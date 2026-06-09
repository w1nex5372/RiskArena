import { useState } from 'react';
import { CLASS_INFO } from '../../utils/characters';

// Slot N unlocks at this level: 1st = start, 2nd @ 10, 3rd @ 15.
const CLASS_SLOT_LEVELS = [1, 10, 15];

function unlockedOf(user) {
  const fromServer = user?.unlocked_classes;
  if (Array.isArray(fromServer) && fromServer.length) {
    return fromServer.map((c) => String(c).toLowerCase());
  }
  const active = String(user?.class_name || '').trim().toLowerCase();
  return active ? [active] : [];
}

/**
 * Slot-based class switcher. Shows every class slot:
 *  - owned  → tap to switch (active highlighted)
 *  - ready  → a pending unlock is available
 *  - locked → "Lvl 10 / 15"
 * `onSwitch(cls)` should persist the active class and return a promise.
 */
export default function ClassSwitcher({ user, onSwitch, title = 'Class — tap to switch', style }) {
  const [switching, setSwitching] = useState(null);
  const active = String(user?.class_name || '').trim().toLowerCase();
  const unlocked = unlockedOf(user);
  const pending = user?.pending_class_unlocks || 0;

  if (!active) return null;

  const handle = async (cls) => {
    if (switching || cls === active) return;
    setSwitching(cls);
    try {
      await onSwitch(cls);
    } catch {
      /* caller toasts */
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div style={{
      background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.2)',
      borderRadius: 14, padding: '12px 14px', ...style,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {title}
        </span>
        {pending > 0 && (
          <span style={{ fontSize: 9, fontWeight: 800, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '2px 7px' }}>
            ✦ New ready
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
        {CLASS_SLOT_LEVELS.map((reqLevel, slotIndex) => {
          const ownedClass = unlocked[slotIndex];
          if (ownedClass) {
            const info = CLASS_INFO[ownedClass] || {};
            const isActive = ownedClass === active;
            const isSwitching = switching === ownedClass;
            return (
              <button
                key={slotIndex}
                type="button"
                onClick={() => handle(ownedClass)}
                disabled={isActive || !!switching}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  padding: '10px 5px 9px', borderRadius: 11, cursor: isActive ? 'default' : 'pointer',
                  background: isActive ? `${info.color || '#c9a84c'}1f` : 'rgba(255,255,255,0.03)',
                  border: isActive ? `1.5px solid ${info.color || '#c9a84c'}` : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: isActive ? `0 0 14px ${info.glow || 'rgba(201,168,76,0.4)'}` : 'none',
                  color: 'inherit', transition: 'all 0.15s ease', appearance: 'none',
                  opacity: isSwitching ? 0.6 : 1,
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1 }}>{info.icon || '✦'}</span>
                <span style={{ fontSize: 12, fontWeight: 900, color: isActive ? (info.color || '#c9a84c') : '#e8e0d0' }}>
                  {info.name || ownedClass}
                </span>
                <span style={{
                  fontSize: 8.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: isActive ? '#22c55e' : '#64748b',
                }}>
                  {isActive ? 'Active ✓' : isSwitching ? '…' : 'Switch'}
                </span>
              </button>
            );
          }
          const claimable = slotIndex < unlocked.length + pending;
          return (
            <div
              key={slotIndex}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                padding: '10px 5px 9px', borderRadius: 11,
                background: claimable ? 'rgba(201,168,76,0.08)' : 'rgba(255,255,255,0.02)',
                border: claimable ? '1px dashed rgba(201,168,76,0.4)' : '1px dashed rgba(148,163,184,0.18)',
                opacity: claimable ? 1 : 0.7,
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1, filter: claimable ? 'none' : 'grayscale(1)' }}>
                {claimable ? '✦' : '🔒'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: claimable ? '#c9a84c' : '#64748b' }}>
                {claimable ? 'Ready!' : 'Locked'}
              </span>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: '#64748b' }}>
                Lvl {reqLevel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
