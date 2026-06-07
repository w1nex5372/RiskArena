import { useEffect, useMemo, useState } from 'react';
import { Check, Sparkles, Swords, X } from 'lucide-react';
import CharacterPortrait from '../arena/CharacterPortrait';
import { CLASS_INFO } from '../../utils/characters';

const FALLBACK = { name: '', title: '', icon: '✦', color: '#c9a84c', glow: 'rgba(201,168,76,0.5)', bonuses: [] };
const info = (cls) => CLASS_INFO[cls] || FALLBACK;

// One card in the chooser row.
function ClassCard({ cls, selected, onSelect }) {
  const meta = info(cls);
  const bonuses = (meta.bonuses || []).slice(0, 3);
  return (
    <button
      type="button"
      onClick={() => onSelect(cls)}
      style={{
        flex: 1, minWidth: 0, cursor: 'pointer', appearance: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '14px 10px 12px', borderRadius: 18,
        background: selected
          ? `linear-gradient(180deg, ${meta.color}1f 0%, rgba(8,12,24,0.96) 70%)`
          : 'linear-gradient(180deg, rgba(15,23,42,0.9), rgba(8,12,24,0.96))',
        border: selected ? `1.5px solid ${meta.color}` : '1px solid rgba(255,255,255,0.08)',
        boxShadow: selected ? `0 0 26px ${meta.glow}, 0 0 0 3px ${meta.color}22` : '0 6px 18px rgba(0,0,0,0.4)',
        transform: selected ? 'translateY(-3px) scale(1.02)' : 'none',
        transition: 'all 0.18s ease', color: 'inherit', position: 'relative',
      }}
    >
      {selected && (
        <div style={{
          position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 999,
          background: meta.color, color: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 12px ${meta.glow}`,
        }}>
          <Check size={13} strokeWidth={3} />
        </div>
      )}
      <CharacterPortrait
        cls={cls}
        size={96}
        active={selected}
        showWeaponBadge={false}
        showArmorBadge={false}
        showHelmetBadge={false}
        style={{ border: `1px solid ${meta.color}44`, boxShadow: `0 0 18px ${meta.glow}` }}
      />
      <div style={{ fontSize: 17, fontWeight: 900, color: selected ? meta.color : '#e8e0d0', lineHeight: 1 }}>
        {meta.icon} {meta.name}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.2, textAlign: 'center', minHeight: 24 }}>
        {meta.title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', marginTop: 2 }}>
        {bonuses.map((b, i) => (
          <div key={i} style={{
            fontSize: 9.5, fontWeight: 700, color: selected ? meta.color : '#cbd5e1',
            background: selected ? `${meta.color}14` : 'rgba(255,255,255,0.04)',
            border: `1px solid ${selected ? meta.color + '33' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: 8, padding: '4px 7px', textAlign: 'center', lineHeight: 1.25,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {b}
          </div>
        ))}
      </div>
    </button>
  );
}

export default function ClassUnlockModal({
  claimableClasses = [],
  level,
  onClaim,
  onClose,
}) {
  const claimable = useMemo(
    () => claimableClasses.filter((c) => CLASS_INFO[c]),
    [claimableClasses],
  );
  const [selected, setSelected] = useState(() => (claimable.length === 1 ? claimable[0] : null));
  const [busy, setBusy] = useState(false);

  // If the claimable set narrows to one (e.g. after a prior claim), auto-select it.
  useEffect(() => {
    if (claimable.length === 1) setSelected(claimable[0]);
  }, [claimable]);

  if (!claimable.length) return null;

  const meta = selected ? info(selected) : FALLBACK;

  async function handleClaim() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      // Parent unlocks + switches + opens the character builder for this class.
      await onClaim(selected);
      onClose?.();
    } catch {
      /* parent toasts the error */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'radial-gradient(ellipse at 50% 22%, rgba(201,168,76,0.16) 0%, transparent 55%), rgba(4,6,12,0.92)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 18, overflowY: 'auto',
    }}>
      <style>{`
        @keyframes cu_rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes cu_glow { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
      `}</style>

      <div style={{ width: '100%', maxWidth: 460, animation: 'cu_rise 0.35s ease both' }}>
        {/* dismiss */}
        <button onClick={onClose} aria-label="Later" style={{
          position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: 10,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
          color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <X size={17} />
        </button>

        {/* header */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 14px', borderRadius: 999,
            background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.32)',
            color: '#c9a84c', fontSize: 11, fontWeight: 900, letterSpacing: '0.14em',
            animation: 'cu_glow 2.2s ease-in-out infinite',
          }}>
            <Sparkles size={13} /> {level ? `LEVEL ${level} REACHED` : 'NEW CLASS SLOT'}
          </div>
          <h2 style={{
            fontSize: 27, fontWeight: 900, color: '#fff', margin: '14px 0 4px', letterSpacing: '0.02em',
            textShadow: '0 0 26px rgba(201,168,76,0.35)',
          }}>
            A NEW CLASS AWAITS
          </h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: 0, fontWeight: 600 }}>
            Pick a class — then customize how your fighter looks
          </p>
        </div>

        {/* cards */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 20 }}>
          {claimable.map((cls) => (
            <ClassCard key={cls} cls={cls} selected={selected === cls} onSelect={setSelected} />
          ))}
        </div>

        {/* confirm */}
        <button
          onClick={handleClaim}
          disabled={!selected || busy}
          style={{
            width: '100%', height: 52, borderRadius: 16, fontWeight: 900, fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            cursor: !selected || busy ? 'not-allowed' : 'pointer',
            background: !selected
              ? 'rgba(255,255,255,0.05)'
              : `linear-gradient(135deg, ${meta.color}, #7a5a10)`,
            border: !selected ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${meta.color}`,
            color: !selected ? '#64748b' : '#0a0a0a',
            boxShadow: !selected ? 'none' : `0 0 26px ${meta.glow}`,
            transition: 'all 0.18s ease',
          }}
        >
          <Swords size={18} />
          {busy ? 'Unlocking…' : selected ? `CREATE YOUR ${meta.name.toUpperCase()}` : 'SELECT A CLASS'}
        </button>
      </div>
    </div>
  );
}
