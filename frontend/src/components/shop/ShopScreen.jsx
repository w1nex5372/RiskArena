import { useEffect, useMemo, useState } from 'react';
import { Filter, Shield, Sparkles, Sword } from 'lucide-react';
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
const CLASS_ICON = { all: '✦', warrior: '⚔️', mage: '🔮', rogue: '🗡️' };

const SLOT_ICON = { weapon: Sword, armor: Shield, ability: Sparkles };

function rarityRingClass(item) {
  const tier = getTierKey(item);
  if (tier === 'legendary') return 'rarity-ring-legendary';
  if (tier === 'epic') return 'rarity-ring-epic';
  if (tier === 'rare') return 'rarity-ring-rare';
  if (tier === 'uncommon') return 'rarity-ring-uncommon';
  return '';
}

function rarityCardClass(item) {
  const tier = getTierKey(item);
  if (tier === 'legendary') return 'rarity-card-legendary';
  if (tier === 'epic') return 'rarity-card-epic';
  if (tier === 'rare') return 'rarity-card-rare';
  if (tier === 'uncommon') return 'rarity-card-uncommon';
  return '';
}

function ItemImage({ item, size = 54 }) {
  const [failed, setFailed] = useState(false);
  const theme = getTierTheme(item);
  const src = getItemImageSrc(item);
  const Icon = SLOT_ICON[getSlotKey(item)] || Sword;
  const ringClass = rarityRingClass(item);

  useEffect(() => { setFailed(false); }, [src]);

  if (failed) {
    return (
      <div className={ringClass} style={{
        width: size, height: size, borderRadius: 14, flexShrink: 0,
        background: `linear-gradient(135deg, ${theme.soft}, rgba(255,255,255,0.02))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon style={{ width: size * 0.42, height: size * 0.42, color: theme.color }} />
      </div>
    );
  }

  return (
    <img src={src} alt={item.name} className={ringClass} style={{
      width: size, height: size, borderRadius: 14, objectFit: 'cover', flexShrink: 0,
    }} onError={() => setFailed(true)} />
  );
}

function MetaChip({ children, style }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '2px 6px',
      borderRadius: 999, letterSpacing: '0.04em', textTransform: 'uppercase', ...style,
    }}>
      {children}
    </span>
  );
}

export default function ShopScreen({ user, onInventoryChanged }) {
  const [items, setItems] = useState(null);
  const [ownedCounts, setOwnedCounts] = useState({});
  const [buying, setBuying] = useState(null);
  const [balance, setBalance] = useState(user?.token_balance || 0);
  const [tierFilter, setTierFilter] = useState('common');
  const [classFilter, setClassFilter] = useState('all');

  useEffect(() => { setBalance(user?.token_balance || 0); }, [user?.token_balance]);

  useEffect(() => {
    apiClient.get('/shop/items')
      .then((r) => setItems(r.data?.items || r.data || []))
      .catch(() => setItems([]));

    apiClient.get('/me/inventory')
      .then((r) => {
        const inv = r.data?.items || (Array.isArray(r.data) ? r.data : []);
        const counts = {};
        inv.forEach((item) => { if (item.item_id) counts[item.item_id] = (counts[item.item_id] || 0) + 1; });
        setOwnedCounts(counts);
      })
      .catch(() => {});
  }, []);

  const visibleItems = useMemo(() => (items || []).filter((item) => {
    const catalogId = item.item_id || item.id;
    if (ownedCounts[catalogId] > 0) return false;
    return getTierKey(item) === tierFilter && (classFilter === 'all' || getClassKey(item) === classFilter);
  }), [items, tierFilter, classFilter, ownedCounts]);

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

      {/* ── Filter strip ──────────────────────────────────────── */}
      <div style={{
        borderRadius: 18, padding: '12px 14px', marginBottom: 12,
        background: 'rgba(10,10,22,0.97)',
        border: '1px solid rgba(201,168,76,0.2)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ color: '#c9a84c', fontSize: 10, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
            Armory
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#475569', fontSize: 10, fontWeight: 700 }}>Balance</span>
            <span style={{ color: '#c9a84c', fontSize: 13, fontWeight: 900 }}>{balance.toLocaleString()}</span>
          </div>
        </div>

        {/* Tier row */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {SHOP_TIERS.map((tier) => {
            const active = tierFilter === tier;
            const theme = getTierTheme({ tier });
            return (
              <button key={tier} type="button" onClick={() => setTierFilter(tier)} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                borderRadius: 10, padding: '7px 4px',
                border: active ? `1px solid ${theme.border}` : '1px solid rgba(255,255,255,0.06)',
                background: active ? theme.soft : 'rgba(255,255,255,0.03)',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: active ? theme.color : '#334155',
                  boxShadow: active ? `0 0 7px ${theme.color}` : 'none',
                }} />
                <span style={{ fontSize: 11, fontWeight: 900, color: active ? theme.color : '#475569' }}>
                  {TIER_LABEL[tier]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Class row */}
        <div style={{ display: 'flex', gap: 5 }}>
          {SHOP_CLASSES.map((cls) => {
            const active = classFilter === cls;
            const isYou = cls !== 'all' && cls === userClass;
            const theme = CLASS_THEME[cls] || { bg: 'rgba(255,255,255,0.06)', color: '#cbd5e1' };
            return (
              <button key={cls} type="button" onClick={() => setClassFilter(cls)} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                borderRadius: 10, padding: '7px 4px',
                border: active
                  ? `1px solid ${isYou ? 'rgba(201,168,76,0.55)' : theme.color + '66'}`
                  : '1px solid rgba(255,255,255,0.06)',
                background: active
                  ? (isYou ? 'rgba(201,168,76,0.12)' : theme.bg)
                  : 'rgba(255,255,255,0.03)',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>{CLASS_ICON[cls]}</span>
                <span style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase',
                  color: active ? (isYou ? '#c9a84c' : theme.color) : '#475569',
                }}>
                  {cls === 'all' ? 'All' : formatClassLabel(cls)}{isYou ? ' ✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Item list ─────────────────────────────────────────── */}
      {items === null ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 110, borderRadius: 16, background: 'rgba(26,26,46,0.55)', border: '1px solid rgba(201,168,76,0.08)' }} />
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <div style={{ borderRadius: 18, padding: '28px 16px', textAlign: 'center', background: 'rgba(26,26,46,0.72)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <Filter style={{ width: 26, height: 26, color: '#334155', margin: '0 auto 10px' }} />
          <p style={{ color: '#94a3b8', fontWeight: 900, fontSize: 13, margin: 0 }}>No gear in this filter</p>
          <p style={{ color: '#475569', fontSize: 11, margin: '4px 0 0' }}>Try another tier or class.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {visibleItems.map((item) => {
            const theme = getTierTheme(item);
            const statRows = getItemStatRows(item);
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
              <article key={item.id} className={rarityCardClass(item)} style={{
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(12,16,32,0.98), rgba(22,26,46,0.96))',
                border: `1px solid ${theme.border}`,
                overflow: 'hidden',
              }}>
                {/* Thin tier accent bar */}
                <div style={{ height: 3, background: `linear-gradient(90deg, ${theme.color}, transparent)` }} />

                <div style={{ padding: '12px 12px 10px' }}>
                  {/* Top row: image + info */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <ItemImage item={item} size={52} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Name + price */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <p className={getTierKey(item) === 'legendary' ? 'rarity-name-legendary' : ''} style={{ color: '#f1f5f9', fontWeight: 900, fontSize: 15, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </p>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ color: '#c9a84c', fontSize: 15, fontWeight: 900, margin: 0 }}>{price.toLocaleString()}</p>
                          <p style={{ color: '#475569', fontSize: 9, fontWeight: 800, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>coins</p>
                        </div>
                      </div>

                      {/* Tags */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                        <MetaChip style={{ color: theme.color, background: theme.soft, border: `1px solid ${theme.border}` }}>
                          {TIER_LABEL[getTierKey(item)]}
                        </MetaChip>
                        <MetaChip style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                          {formatSlotLabel(slot)}
                        </MetaChip>
                        <MetaChip style={{ color: classTheme.color, background: classTheme.bg, border: '1px solid transparent' }}>
                          {formatClassLabel(itemClass)}
                        </MetaChip>
                        {ownedCount > 0 && (
                          <MetaChip style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                            Owned
                          </MetaChip>
                        )}
                      </div>

                      {/* Stat chips */}
                      {statRows.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                          {statRows.slice(0, 4).map((row) => (
                            <span key={row.key} style={{
                              fontSize: 11, fontWeight: 800, color: theme.color,
                              background: theme.soft, border: `1px solid ${theme.border}`,
                              borderRadius: 999, padding: '3px 8px',
                            }}>
                              {row.label}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Passive */}
                      {passiveText && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                          <Sparkles style={{ width: 10, height: 10, color: '#c9a84c', flexShrink: 0 }} />
                          <span style={{ color: '#c9a84c', fontSize: 10, fontWeight: 800 }}>{passiveText}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Buy button */}
                  <button
                    onClick={() => handleBuy(item)}
                    disabled={classMismatch || !canAfford || isBuying || ownedCount > 0}
                    style={{
                      width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 12,
                      background: classMismatch || !canAfford || ownedCount > 0
                        ? 'rgba(255,255,255,0.04)'
                        : isBuying
                        ? 'rgba(201,168,76,0.3)'
                        : 'linear-gradient(135deg, #7a5a10, #c9a84c)',
                      border: classMismatch || !canAfford || ownedCount > 0
                        ? '1px solid rgba(255,255,255,0.07)'
                        : '1px solid rgba(201,168,76,0.4)',
                      color: classMismatch || !canAfford || ownedCount > 0 ? '#475569' : '#0a0a0a',
                      fontWeight: 900, fontSize: 13,
                      cursor: classMismatch || !canAfford || isBuying || ownedCount > 0 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {ownedCount > 0
                      ? 'Already owned'
                      : classMismatch
                      ? `${formatClassLabel(itemClass)} class only`
                      : isBuying
                      ? 'Buying...'
                      : !canAfford
                      ? `Need ${(price - balance).toLocaleString()} more coins`
                      : `Buy — ${price.toLocaleString()} coins`}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
