import { useEffect, useState } from 'react';
import { Backpack, BatteryCharging, Gem, Shield, Sparkles, Sword } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import apiClient from '../../api/client';

const TABS = ['Weapon', 'Armor', 'Ability', 'Consumables'];

const TAB_CATEGORY = {
  Weapon:      'weapon',
  Armor:       'armor',
  Ability:     'ability',
  Consumables: 'consumable',
};

const TAB_ICON = {
  Weapon:      Sword,
  Armor:       Shield,
  Ability:     Sparkles,
  Consumables: BatteryCharging,
};

const RARITY_INLINE = {
  Common:    { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' },
  Uncommon:  { background: 'rgba(34,197,94,0.15)',   color: '#22c55e' },
  Rare:      { background: 'rgba(59,130,246,0.15)',   color: '#3b82f6' },
  Epic:      { background: 'rgba(168,85,247,0.15)',   color: '#a855f7' },
  Legendary: { background: 'rgba(201,168,76,0.2)',    color: '#c9a84c' },
};

const RARITY_BORDER = {
  Common:    'rgba(148,163,184,0.2)',
  Uncommon:  'rgba(34,197,94,0.25)',
  Rare:      'rgba(59,130,246,0.25)',
  Epic:      'rgba(168,85,247,0.25)',
  Legendary: 'rgba(201,168,76,0.4)',
};

export default function InventoryScreen({ user }) {
  const [activeTab,   setActiveTab]   = useState('Weapon');
  const [inventory,   setInventory]   = useState(null); // null = loading
  const [equippedIds, setEquippedIds] = useState(new Set());
  const [loadError,   setLoadError]   = useState(false);
  const [equipping,   setEquipping]   = useState(null); // item id being equipped
  const [retryKey,    setRetryKey]    = useState(0);

  const loadEquipped = () =>
    apiClient.get('/me/equipped')
      .then((res) => {
        const items = res.data?.equipped_items || (Array.isArray(res.data) ? res.data : []);
        setEquippedIds(new Set(items.map((i) => i.id)));
      })
      .catch(() => {});

  useEffect(() => {
    let cancelled = false;
    setInventory(null);
    setLoadError(false);

    Promise.all([
      apiClient.get('/inventory'),
      apiClient.get('/me/equipped').catch(() => ({ data: [] })),
    ])
      .then(([invRes, eqRes]) => {
        if (cancelled) return;
        setInventory(Array.isArray(invRes.data) ? invRes.data : invRes.data?.items ?? []);
        const eqItems = eqRes.data?.equipped_items || (Array.isArray(eqRes.data) ? eqRes.data : []);
        setEquippedIds(new Set(eqItems.map((i) => i.id)));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => { cancelled = true; };
  }, [retryKey]);

  const handleEquip = async (item) => {
    if (equipping) return;
    setEquipping(item.id);
    try {
      await apiClient.post('/me/equip', { item_id: item.id });
      toast.success('Equipped!');
      await loadEquipped();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to equip item');
    }
    setEquipping(null);
  };

  const matchCategory = (cat, tab) => {
    const c   = (cat || '').toLowerCase();
    const key = TAB_CATEGORY[tab];
    return c === key || c.startsWith(key);
  };

  const userClass = (user?.class_name || '').toLowerCase();
  const tabItems  = (inventory || []).filter((item) => matchCategory(item.category || item.type, activeTab));
  const Icon      = TAB_ICON[activeTab];

  // ── Error state ──────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="space-y-4" style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(139,0,0,0.3)' }}>
          <p className="text-sm font-bold mb-3" style={{ color: '#ef4444' }}>Failed to load inventory.</p>
          <Button
            onClick={() => setRetryKey((k) => k + 1)}
            style={{ background: 'linear-gradient(135deg,#8b0000,#c0392b)', color: 'white', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 12, fontWeight: 800 }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ color: '#e8e0d0' }}>

      {/* Header */}
      <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(201,168,76,0.2)', boxShadow: '0 12px 30px rgba(0,0,0,0.3)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#c9a84c' }}>Inventory</p>
            <h2 className="text-2xl font-extrabold mt-1" style={{ color: '#e8e0d0' }}>Loadout</h2>
            <p className="text-sm font-medium" style={{ color: '#64748b' }}>Tune your next run.</p>
          </div>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#8b0000,#c0392b)', boxShadow: '0 4px 16px rgba(139,0,0,0.4)' }}>
            <Backpack className="w-6 h-6" style={{ color: 'white' }} />
          </div>
        </div>
      </section>

      {/* Level + coins */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-[22px] p-4" style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.15)' }}>
          <p className="text-xs font-bold" style={{ color: '#64748b' }}>Level</p>
          <p className="text-3xl font-extrabold" style={{ color: '#c9a84c' }}>{user?.level || 1}</p>
        </div>
        <div className="rounded-[22px] p-4" style={{ background: 'rgba(13,13,26,0.95)', border: '1px solid rgba(201,168,76,0.2)' }}>
          <p className="text-xs font-bold" style={{ color: '#64748b' }}>Coins</p>
          <p className="text-3xl font-extrabold" style={{ color: '#e8e0d0' }}>{(user?.token_balance || 0).toLocaleString()}</p>
        </div>
      </section>

      {/* Tab bar */}
      <section className="rounded-[24px] p-3" style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.15)' }}>
        <div className="grid grid-cols-4 gap-1 rounded-2xl p-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                borderRadius: 10, padding: '6px 4px', fontSize: 11, fontWeight: 800,
                border: 'none', cursor: 'pointer',
                background: activeTab === tab ? 'linear-gradient(135deg,#8b0000,#c0392b)' : 'transparent',
                color: activeTab === tab ? 'white' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </section>

      {/* Item list */}
      <section className="space-y-3">
        {inventory === null ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="rounded-[22px] p-4 h-20 animate-pulse" style={{ background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(201,168,76,0.1)' }} />
          ))
        ) : tabItems.length === 0 ? (
          <div className="rounded-[22px] p-8 text-center" style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <Icon className="w-7 h-7" style={{ color: '#334155' }} />
            </div>
            <p className="text-sm font-bold" style={{ color: '#64748b' }}>No {activeTab.toLowerCase()} items</p>
            <p className="text-xs mt-1" style={{ color: '#475569' }}>Win games or visit the shop to earn gear.</p>
          </div>
        ) : (
          tabItems.map((item) => {
            const rarity      = item.rarity || 'Common';
            const rarityInline = RARITY_INLINE[rarity] || RARITY_INLINE.Common;
            const borderColor  = RARITY_BORDER[rarity] || RARITY_BORDER.Common;
            const isEquipped   = equippedIds.has(item.id) || !!item.equipped;
            const isEquipping  = equipping === item.id;
            const itemClass    = (item.class_name || '').toLowerCase();
            const wrongClass   = !!userClass && !!itemClass && itemClass !== userClass;

            return (
              <div
                key={item.id}
                className="rounded-[22px] p-4"
                style={{
                  background: isEquipped ? 'rgba(201,168,76,0.06)' : 'rgba(26,26,46,0.8)',
                  border: `1px solid ${isEquipped ? 'rgba(201,168,76,0.4)' : borderColor}`,
                  boxShadow: isEquipped ? '0 0 16px rgba(201,168,76,0.1)' : 'none',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${borderColor}` }}>
                    <Icon className="w-6 h-6" style={{ color: rarityInline.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-extrabold" style={{ color: '#e8e0d0' }}>{item.name}</h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={rarityInline}>{rarity}</span>
                      {isEquipped && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(201,168,76,0.2)', color: '#c9a84c' }}>
                          EQUIPPED
                        </span>
                      )}
                    </div>
                    {item.stats && (
                      <p className="text-xs font-medium mt-0.5 truncate" style={{ color: '#64748b' }}>{item.stats}</p>
                    )}
                  </div>

                  {/* Action area */}
                  {isEquipped ? null : wrongClass ? (
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#475569' }}>
                      Class locked
                    </span>
                  ) : (
                    <Button
                      onClick={() => handleEquip(item)}
                      disabled={!!isEquipping}
                      style={{
                        flexShrink: 0, height: 36, padding: '0 14px', borderRadius: 12,
                        fontWeight: 800, fontSize: 12,
                        background: isEquipping
                          ? 'rgba(255,255,255,0.05)'
                          : 'linear-gradient(135deg,#8b0000,#c0392b)',
                        color: isEquipping ? '#475569' : 'white',
                        border: '1px solid rgba(201,168,76,0.25)',
                        cursor: isEquipping ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isEquipping ? '...' : 'Equip'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Upgrade materials */}
      {inventory !== null && (
        <section className="rounded-[24px] p-4" style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.15)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Gem className="w-4 h-4" style={{ color: '#c9a84c' }} />
            <h3 className="font-extrabold" style={{ color: '#e8e0d0' }}>Upgrade materials</h3>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Shards',  value: user?.shards  ?? '—' },
              { label: 'Cores',   value: user?.cores   ?? '—' },
              { label: 'Tickets', value: user?.tickets ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-xl font-extrabold" style={{ color: '#e8e0d0' }}>{value}</p>
                <p className="text-[11px] font-medium" style={{ color: '#64748b' }}>{label}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
