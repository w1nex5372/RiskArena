import { useEffect, useMemo, useState } from 'react';
import { Backpack, Swords, X, Zap } from 'lucide-react';
import apiClient from '../../api/client';
import { RAID_UNLOCK_LEVEL } from '../../utils/progression';

function guideKey(user) {
  return `riskarena:new-user-guide:v1:${user?.id || user?.telegram_id || 'guest'}`;
}

export default function NewUserGuide({ user, onNavigate }) {
  const [visible, setVisible] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const key = useMemo(() => guideKey(user), [user?.id, user?.telegram_id]);

  useEffect(() => {
    if (!user?.id && !user?.telegram_id) return;
    try {
      setVisible(localStorage.getItem(key) !== 'done');
    } catch {
      setVisible(false);
    }
  }, [key, user?.id, user?.telegram_id]);

  const close = () => {
    try { localStorage.setItem(key, 'done'); } catch {}
    setVisible(false);
  };

  const go = (tab) => {
    close();
    onNavigate?.(tab);
  };

  const openItems = async () => {
    setClaiming(true);
    try {
      await apiClient.get('/me/starter-items');
    } catch {
      // Starter items are best-effort; Items still shows current inventory/shop.
    } finally {
      setClaiming(false);
      go('inventory');
    }
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(2,6,23,0.76)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="RiskArena first steps"
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          borderRadius: 18,
          background: 'linear-gradient(180deg, #101827 0%, #0b1020 100%)',
          border: '1px solid rgba(201,168,76,0.34)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.62)',
          color: '#e8e0d0',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(201,168,76,0.12)',
                border: '1px solid rgba(201,168,76,0.28)',
                color: '#c9a84c',
                flexShrink: 0,
              }}
            >
              <Swords size={24} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, color: '#c9a84c', fontSize: 10, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                First steps
              </p>
              <h2 style={{ margin: '4px 0 0', color: '#f8fafc', fontSize: 22, lineHeight: 1.05, fontWeight: 950 }}>
                Prepare your fighter
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close guide"
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.18)',
                background: 'rgba(255,255,255,0.04)',
                color: '#94a3b8',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <X size={16} />
            </button>
          </div>
          <p style={{ margin: '12px 0 0', color: '#94a3b8', fontSize: 13, lineHeight: 1.45 }}>
            The arena opens with one rule: gear first, fight second. Equip a weapon, warm up in Arena, then climb toward Boss Raid.
          </p>
        </div>

        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          {[
            { icon: Backpack, title: 'Equip your first weapon', copy: 'Open Items and put your strongest weapon into the loadout.' },
            { icon: Swords, title: 'Enter Arena warm-up', copy: 'Move, jump, attack, block, and test skills while waiting for an opponent.' },
            { icon: Zap, title: `Unlock Raid at Level ${RAID_UNLOCK_LEVEL}`, copy: 'Boss Raid becomes the bigger loot goal after you learn combat.' },
          ].map(({ icon: Icon, title, copy }) => (
            <div
              key={title}
              style={{
                display: 'flex',
                gap: 10,
                padding: 10,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              <Icon size={18} style={{ color: '#c9a84c', marginTop: 1, flexShrink: 0 }} />
              <div>
                <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 850 }}>{title}</div>
                <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>{copy}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '0 16px 16px' }}>
          <button
            type="button"
            onClick={openItems}
            disabled={claiming}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 12,
              border: '1px solid rgba(201,168,76,0.45)',
              background: 'linear-gradient(135deg, #c9a84c, #8b6914)',
              color: '#080812',
              fontSize: 13,
              fontWeight: 950,
              cursor: claiming ? 'wait' : 'pointer',
              opacity: claiming ? 0.75 : 1,
            }}
          >
            {claiming ? 'Preparing gear...' : 'Open Items'}
          </button>
          <button
            type="button"
            onClick={() => go('arena')}
            style={{
              minHeight: 44,
              padding: '0 14px',
              borderRadius: 12,
              border: '1px solid rgba(148,163,184,0.18)',
              background: 'rgba(255,255,255,0.04)',
              color: '#cbd5e1',
              fontSize: 13,
              fontWeight: 850,
              cursor: 'pointer',
            }}
          >
            Arena
          </button>
        </div>
      </div>
    </div>
  );
}
