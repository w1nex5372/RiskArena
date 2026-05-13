import { useEffect, useState } from 'react';
import { Shield, ShoppingBag, Sparkles, Sword } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../api/client';

const TIER_ORDER = ['uncommon', 'rare'];

const TIER_COLOR = {
  common:    '#94a3b8',
  uncommon:  '#22c55e',
  rare:      '#3b82f6',
  epic:      '#a855f7',
  legendary: '#c9a84c',
};

const TIER_LABEL = {
  uncommon: 'Uncommon',
  rare:     'Rare',
};

const SLOT_ICON = {
  weapon:  Sword,
  armor:   Shield,
  ability: Sparkles,
};

const CLASS_COLOR = {
  warrior: { bg: 'rgba(139,0,0,0.2)',       color: '#f87171' },
  mage:    { bg: 'rgba(74,144,217,0.15)',    color: '#60a5fa' },
  rogue:   { bg: 'rgba(201,168,76,0.15)',    color: '#c9a84c' },
};

function tierKey(item) {
  return (item.tier || item.rarity || '').toLowerCase();
}

function ItemImage({ item, size = 56 }) {
  const [err, setErr] = useState(false);
  const slot      = (item.slot || item.category || item.type || '').toLowerCase();
  const className = (item.class_name || 'warrior').toLowerCase();
  const src       = item.image_path || `/items/${className}_${slot}.png`;
  const color     = TIER_COLOR[tierKey(item)] || TIER_COLOR.common;
  const Icon      = SLOT_ICON[slot] || Sword;

  if (err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 12, flexShrink: 0,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${color}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon style={{ width: size * 0.44, height: size * 0.44, color }} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={item.name}
      style={{
        width: size, height: size, borderRadius: 12, objectFit: 'cover',
        border: `1px solid ${color}40`, flexShrink: 0,
      }}
      onError={() => setErr(true)}
    />
  );
}

export default function ShopScreen({ user }) {
  const [items,    setItems]    = useState(null);
  const [ownedIds, setOwnedIds] = useState(new Set());
  const [buying,   setBuying]   = useState(null);
  const [balance,  setBalance]  = useState(user?.token_balance || 0);

  // keep balance in sync when user prop changes
  useEffect(() => { setBalance(user?.token_balance || 0); }, [user?.token_balance]);

  useEffect(() => {
    apiClient.get('/shop/items')
      .then((r) => setItems(r.data?.items || r.data || []))
      .catch(() => setItems([]));

    apiClient.get('/me/inventory')
      .then((r) => {
        const inv = r.data?.items || (Array.isArray(r.data) ? r.data : []);
        setOwnedIds(new Set(inv.map((i) => i.id)));
      })
      .catch(() => {});
  }, []);

  const handleBuy = async (item) => {
    if (buying) return;
    setBuying(item.id);
    try {
      const res = await apiClient.post('/shop/buy', { item_id: item.id });
      toast.success('Purchased!');
      setOwnedIds((prev) => new Set([...prev, item.id]));
      if (res.data?.new_balance != null) setBalance(res.data.new_balance);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Purchase failed');
    }
    setBuying(null);
  };

  // Group by tier, skip epic/legendary
  const grouped = {};
  (items || []).forEach((item) => {
    const t = tierKey(item);
    if (!TIER_ORDER.includes(t)) return;
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(item);
  });

  const userClass = (user?.class_name || '').toLowerCase();

  return (
    <div style={{ background: '#1a1a2e', minHeight: '100%', paddingBottom: 100, color: '#e8e0d0' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        margin: '12px 16px 0',
        borderRadius: 20,
        background: 'linear-gradient(135deg, #0d0d1a 0%, #1a0a0a 50%, #2d1a00 100%)',
        border: '1px solid rgba(201,168,76,0.3)',
        borderBottom: '2px solid rgba(201,168,76,0.4)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        padding: '18px 20px 16px',
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ position: 'absolute', right: -20, top: -20, width: 120, height: 120, background: 'radial-gradient(circle, rgba(201,168,76,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#c9a84c', margin: '0 0 4px', textTransform: 'uppercase' }}>
            Equipment Shop
          </p>
          <h1 style={{ color: 'white', fontSize: 26, fontWeight: 900, margin: '0 0 2px', letterSpacing: '-0.02em' }}>ARMORY</h1>
          <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
            Balance: <span style={{ color: '#c9a84c', fontWeight: 700 }}>{balance.toLocaleString()}</span> coins
          </p>
        </div>
        <div style={{ width: 48, height: 48, borderRadius: 16, background: 'linear-gradient(135deg,#8b6914,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ShoppingBag style={{ width: 22, height: 22, color: '#0a0a0a' }} />
        </div>
      </div>

      {/* ── Loading skeletons ──────────────────────────────────── */}
      {items === null && (
        <div style={{ padding: '12px 16px 0' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 80, borderRadius: 16, background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(201,168,76,0.08)', marginBottom: 10 }} />
          ))}
        </div>
      )}

      {/* ── Tier sections ──────────────────────────────────────── */}
      {items !== null && TIER_ORDER.map((tier) => {
        const tierItems = grouped[tier];
        if (!tierItems || tierItems.length === 0) return null;
        const color = TIER_COLOR[tier];

        return (
          <div key={tier} style={{ margin: '20px 16px 0' }}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 4, height: 16, borderRadius: 2, background: color, flexShrink: 0 }} />
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color, textTransform: 'uppercase', margin: 0 }}>
                {TIER_LABEL[tier]}
              </p>
            </div>

            {/* Item cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tierItems.map((item) => {
                const owned      = ownedIds.has(item.id);
                const itemClass  = (item.class_name || '').toLowerCase();
                const wrongClass = !!userClass && !!itemClass && itemClass !== userClass;
                const price      = item.price || item.cost || 0;
                const canAfford  = balance >= price;
                const isBuying   = buying === item.id;
                const slot       = (item.slot || item.category || item.type || '').toLowerCase();
                const statLine   = item.stats || item.stat_preview || '';
                const classStyle = CLASS_COLOR[itemClass] || {};

                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: 16,
                      background: owned ? 'rgba(201,168,76,0.04)' : 'rgba(26,26,46,0.8)',
                      border: `1px solid ${owned ? 'rgba(201,168,76,0.25)' : color + '28'}`,
                    }}
                  >
                    <ItemImage item={item} size={56} />

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: 'white', fontWeight: 800, fontSize: 14, margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: statLine ? 4 : 0 }}>
                        {slot && (
                          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {slot}
                          </span>
                        )}
                        {itemClass && (
                          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.06em', background: classStyle.bg || 'rgba(255,255,255,0.06)', color: classStyle.color || '#94a3b8' }}>
                            {itemClass}
                          </span>
                        )}
                      </div>
                      {statLine && (
                        <p style={{ color: '#64748b', fontSize: 11, margin: 0, fontWeight: 500 }}>{statLine}</p>
                      )}
                    </div>

                    {/* Price + Action */}
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, minWidth: 60 }}>
                      {!owned && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ fontSize: 12 }}>🪙</span>
                          <span style={{ color: '#c9a84c', fontWeight: 800, fontSize: 13 }}>{price.toLocaleString()}</span>
                        </div>
                      )}
                      {owned ? (
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>OWNED</span>
                      ) : wrongClass ? (
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#f87171' }}>LOCKED</span>
                      ) : (
                        <button
                          onClick={() => handleBuy(item)}
                          disabled={!canAfford || !!isBuying}
                          style={{
                            padding: '6px 14px', borderRadius: 10,
                            background: canAfford
                              ? 'linear-gradient(135deg, #8b6914, #c9a84c)'
                              : 'rgba(255,255,255,0.05)',
                            border: canAfford
                              ? '1px solid rgba(201,168,76,0.5)'
                              : '1px solid rgba(255,255,255,0.06)',
                            color: canAfford ? '#0a0a0a' : '#334155',
                            fontWeight: 800, fontSize: 12,
                            cursor: canAfford && !isBuying ? 'pointer' : 'not-allowed',
                            opacity: isBuying ? 0.6 : 1,
                          }}
                        >
                          {isBuying ? '...' : 'BUY'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── Empty state ────────────────────────────────────────── */}
      {items !== null && Object.keys(grouped).length === 0 && (
        <div style={{ padding: '60px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 40, margin: '0 0 12px' }}>🛡️</p>
          <p style={{ color: '#64748b', fontWeight: 700, fontSize: 14, margin: 0 }}>No items available right now</p>
        </div>
      )}
    </div>
  );
}
