import { useEffect, useMemo, useState } from 'react';
import { Filter, Shield, ShoppingBag, Sparkles, Sword } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../api/client';
import {
  CLASS_THEME,
  TIER_LABEL,
  formatClassLabel,
  formatSlotLabel,
  getClassKey,
  getItemImageSrc,
  getItemStatRows,
  getPassiveText,
  getSlotKey,
  getTierKey,
  getTierTheme,
} from '../../utils/itemPresentation';

const SHOP_TIERS = ['common', 'uncommon', 'rare'];
const SHOP_CLASSES = ['all', 'warrior', 'mage', 'rogue'];

const SLOT_ICON = {
  weapon: Sword,
  armor: Shield,
  ability: Sparkles,
};

function ItemImage({ item, size = 54 }) {
  const [failed, setFailed] = useState(false);
  const theme = getTierTheme(item);
  const src = getItemImageSrc(item);
  const Icon = SLOT_ICON[getSlotKey(item)] || Sword;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 16,
          flexShrink: 0,
          background: `linear-gradient(135deg, ${theme.soft}, rgba(255,255,255,0.025))`,
          border: `1px solid ${theme.border}`,
          boxShadow: `0 0 14px ${theme.glow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon style={{ width: size * 0.42, height: size * 0.42, color: theme.color }} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item.name}
      style={{
        width: size,
        height: size,
        borderRadius: 16,
        objectFit: 'cover',
        border: `1px solid ${theme.border}`,
        boxShadow: `0 0 14px ${theme.glow}`,
        flexShrink: 0,
      }}
      onError={() => setFailed(true)}
    />
  );
}

function MetaChip({ children, style }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 850,
        padding: '3px 7px',
        borderRadius: 999,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function StatChip({ label, color }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        color,
        padding: '4px 8px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.045)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {label}
    </span>
  );
}

function StatGroup({ title, rows, color }) {
  const visibleRows = (rows || []).filter(Boolean).slice(0, 4);
  if (!visibleRows.length) return null;
  return (
    <div style={{ borderRadius: 12, padding: '8px 9px', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <p style={{ color: '#64748b', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
        {visibleRows.map((row) => (
          <StatChip key={`${title}-${row.key || row.stat || row.label}`} label={row.label} color={color} />
        ))}
      </div>
    </div>
  );
}

export default function ShopScreen({ user, onInventoryChanged }) {
  const [items, setItems] = useState(null);
  const [ownedCounts, setOwnedCounts] = useState({});
  const [buying, setBuying] = useState(null);
  const [balance, setBalance] = useState(user?.token_balance || 0);
  const [tierFilter, setTierFilter] = useState('common');
  const [classFilter, setClassFilter] = useState('all');

  useEffect(() => {
    setBalance(user?.token_balance || 0);
  }, [user?.token_balance]);

  useEffect(() => {
    apiClient.get('/shop/items')
      .then((response) => setItems(response.data?.items || response.data || []))
      .catch(() => setItems([]));

    apiClient.get('/me/inventory')
      .then((response) => {
        const inventory = response.data?.items || (Array.isArray(response.data) ? response.data : []);
        const counts = {};
        inventory.forEach((item) => {
          const key = item.item_id;
          if (!key) return;
          counts[key] = (counts[key] || 0) + 1;
        });
        setOwnedCounts(counts);
      })
      .catch(() => {});
  }, []);

  const visibleItems = useMemo(() => {
    return (items || []).filter((item) => {
      const tierMatches = getTierKey(item) === tierFilter;
      const classMatches = classFilter === 'all' || getClassKey(item) === classFilter;
      return tierMatches && classMatches;
    });
  }, [items, tierFilter, classFilter]);

  const userClass = String(user?.class_name || '').trim().toLowerCase();

  const handleBuy = async (item) => {
    if (buying) return;
    setBuying(item.id);
    try {
      const response = await apiClient.post('/shop/buy', { item_id: item.id });
      setOwnedCounts((prev) => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }));
      if (response.data?.new_balance != null) setBalance(response.data.new_balance);
      onInventoryChanged?.({ newBalance: response.data?.new_balance ?? null });
      toast.success(`Purchased ${item.name}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Purchase failed');
    } finally {
      setBuying(null);
    }
  };

  return (
    <div style={{ color: '#e8e0d0' }}>
      <section
        className="rounded-[22px] p-4"
        style={{
          background: 'linear-gradient(135deg, rgba(13,13,26,0.96), rgba(42,30,8,0.72))',
          border: '1px solid rgba(201,168,76,0.24)',
          boxShadow: '0 12px 28px rgba(0,0,0,0.28)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p style={{ color: '#c9a84c', fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
              Armory
            </p>
            <h3 style={{ color: '#fff', fontSize: 20, fontWeight: 950, margin: '4px 0 0' }}>
              Buy class gear
            </h3>
            <p style={{ color: '#94a3b8', fontSize: 12, fontWeight: 650, margin: '5px 0 0' }}>
              Browse all class gear. Purchase requires your active class to match.
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <ShoppingBag style={{ width: 22, height: 22, color: '#c9a84c', marginLeft: 'auto' }} />
            <p style={{ color: '#64748b', fontSize: 10, fontWeight: 850, margin: '6px 0 0', textTransform: 'uppercase' }}>
              Coins
            </p>
            <p style={{ color: '#c9a84c', fontWeight: 950, fontSize: 16, margin: 0 }}>
              {balance.toLocaleString()}
            </p>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="grid grid-cols-3 gap-2">
            {SHOP_TIERS.map((tier) => {
              const active = tierFilter === tier;
              const theme = getTierTheme({ tier });
              return (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setTierFilter(tier)}
                  style={{
                    borderRadius: 13,
                    padding: '9px 6px',
                    border: active ? `1px solid ${theme.border}` : '1px solid rgba(255,255,255,0.07)',
                    background: active ? theme.soft : 'rgba(255,255,255,0.035)',
                    color: active ? theme.color : '#94a3b8',
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  {TIER_LABEL[tier]}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingTop: 9 }}>
            {SHOP_CLASSES.map((className) => {
              const active = classFilter === className;
              const theme = CLASS_THEME[className] || { bg: 'rgba(255,255,255,0.06)', color: '#cbd5e1' };
              return (
                <button
                  key={className}
                  type="button"
                  onClick={() => setClassFilter(className)}
                  style={{
                    flexShrink: 0,
                    borderRadius: 999,
                    padding: '7px 11px',
                    border: active ? '1px solid rgba(201,168,76,0.3)' : '1px solid rgba(255,255,255,0.07)',
                    background: active ? theme.bg : 'rgba(255,255,255,0.035)',
                    color: active ? theme.color : '#94a3b8',
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  {className === 'all' ? 'All classes' : formatClassLabel(className)}
                  {className !== 'all' && className === userClass ? ' (you)' : ''}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {items === null ? (
        <div className="grid gap-3 mt-3">
          {[1, 2, 3].map((index) => (
            <div key={index} className="animate-pulse" style={{ height: 96, borderRadius: 18, background: 'rgba(26,26,46,0.55)', border: '1px solid rgba(201,168,76,0.08)' }} />
          ))}
        </div>
      ) : null}

      {items !== null ? (
        <section className="grid gap-3 mt-3">
          {visibleItems.length === 0 ? (
            <div className="rounded-[22px] p-7 text-center" style={{ background: 'rgba(26,26,46,0.72)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <Filter className="w-7 h-7 mx-auto mb-3" style={{ color: '#475569' }} />
              <p style={{ color: '#94a3b8', fontWeight: 900, fontSize: 13, margin: 0 }}>No gear in this filter</p>
              <p style={{ color: '#475569', fontSize: 11, margin: '4px 0 0' }}>Try another tier or class.</p>
            </div>
          ) : (
            visibleItems.map((item) => {
              const theme = getTierTheme(item);
              const baseRows = getItemStatRows(item, { source: 'base_stats' });
              const effectiveRows = getItemStatRows(item, { source: 'effective_stats' });
              const passiveText = getPassiveText(item);
              const itemClass = getClassKey(item);
              const slot = getSlotKey(item);
              const classTheme = CLASS_THEME[itemClass] || { bg: 'rgba(255,255,255,0.06)', color: '#94a3b8' };
              const ownedCount = ownedCounts[item.item_id] || 0;
              const price = Number(item.price || 0);
              const canAfford = balance >= price;
              const isBuying = buying === item.id;
              const classMismatch = Boolean(userClass && itemClass && userClass !== itemClass);

              return (
                <article
                  key={item.id}
                  className="rounded-[20px] p-3"
                  style={{
                    background: 'linear-gradient(135deg, rgba(15,23,42,0.92), rgba(26,26,46,0.9))',
                    border: `1px solid ${theme.border}`,
                    boxShadow: `0 0 18px ${theme.glow}`,
                  }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <ItemImage item={item} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ color: '#f8fafc', fontWeight: 950, fontSize: 14, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                            <MetaChip style={{ color: theme.color, background: theme.soft, border: `1px solid ${theme.border}` }}>
                              {TIER_LABEL[getTierKey(item)]}
                            </MetaChip>
                            <MetaChip style={{ color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              {formatSlotLabel(slot)}
                            </MetaChip>
                            <MetaChip style={{ color: classTheme.color, background: classTheme.bg, border: '1px solid transparent' }}>
                              {formatClassLabel(itemClass)}
                            </MetaChip>
                            <MetaChip style={{ color: '#c9a84c', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.18)' }}>
                              +{Number(item.enchant_level || 0)}
                            </MetaChip>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ color: '#c9a84c', fontSize: 16, fontWeight: 950, margin: 0 }}>{price.toLocaleString()}</p>
                          <p style={{ color: '#64748b', fontSize: 10, fontWeight: 800, margin: '1px 0 0' }}>coins</p>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>
                        <StatGroup title="Base" rows={baseRows} color={theme.color} />
                        <StatGroup title="Total" rows={effectiveRows} color="#e8e0d0" />
                      </div>

                      {passiveText ? (
                        <p style={{ color: theme.color, fontSize: 11, fontWeight: 750, margin: '8px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Passive: {passiveText}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 11 }}>
                    <div style={{ minWidth: 0 }}>
                      {classMismatch ? (
                        <p style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, margin: 0 }}>
                          For {formatClassLabel(itemClass)}. Switch class to buy and equip.
                        </p>
                      ) : ownedCount > 0 ? (
                        <p style={{ color: '#c9a84c', fontSize: 11, fontWeight: 800, margin: 0 }}>
                          Owned copies: {ownedCount}
                        </p>
                      ) : (
                        <p style={{ color: '#64748b', fontSize: 11, fontWeight: 700, margin: 0 }}>
                          Fits your current class.
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleBuy(item)}
                      disabled={classMismatch || !canAfford || isBuying}
                      style={{
                        flexShrink: 0,
                        minWidth: 92,
                        padding: '9px 13px',
                        borderRadius: 13,
                        background: classMismatch || !canAfford
                          ? 'rgba(255,255,255,0.045)'
                          : 'linear-gradient(135deg, #8b6914, #c9a84c)',
                        border: classMismatch || !canAfford
                          ? '1px solid rgba(255,255,255,0.07)'
                          : '1px solid rgba(201,168,76,0.5)',
                        color: classMismatch || !canAfford ? '#64748b' : '#0a0a0a',
                        fontWeight: 950,
                        fontSize: 12,
                        cursor: classMismatch || !canAfford || isBuying ? 'not-allowed' : 'pointer',
                        opacity: isBuying ? 0.75 : 1,
                      }}
                    >
                      {classMismatch ? 'Class only' : isBuying ? 'Buying...' : ownedCount > 0 ? 'Buy copy' : 'Buy'}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      ) : null}
    </div>
  );
}
