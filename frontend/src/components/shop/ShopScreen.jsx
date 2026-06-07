import { useEffect, useMemo, useState } from 'react';
import { Filter, HardHat, Lock, Shield, Sparkles, Sword, X } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../api/client';
import {
  CLASS_THEME,
  TIER_LABEL,
  formatClassLabel,
  formatSlotLabel,
  getAbilityBattleRows,
  getClassKey,
  getItemImageSrc,
  getItemStatRows,
  getPassiveText,
  getSlotKey,
  getTierKey,
  getTierLabel,
  getTierTheme,
} from '../../utils/itemPresentation';
import WeaponIcon from '../WeaponIcon';
import ArmorIcon from '../ArmorIcon';

const SHOP_TIERS = ['common', 'uncommon', 'rare'];
const CLASS_ORDER = ['warrior', 'mage', 'rogue'];
const CLASS_ICON = { warrior: '⚔️', mage: '🔮', rogue: '🗡️' };

// Which classes the player can use. Source of truth is the backend's
// `unlocked_classes` if present; otherwise derived from the level rule:
// starting class from the start, 2nd class at level 10, 3rd at level 15.
// The player may switch the active class, so we never drop the active one.
function getUnlockedClasses(user) {
  const fromServer = user?.unlocked_classes;
  if (Array.isArray(fromServer) && fromServer.length) {
    const set = fromServer.map((c) => String(c).toLowerCase()).filter((c) => CLASS_ORDER.includes(c));
    if (set.length) return [...new Set(set)];
  }
  const current = String(user?.class_name || '').trim().toLowerCase();
  const level = Number(user?.level ?? 1);
  const unlocked = [];
  if (CLASS_ORDER.includes(current)) unlocked.push(current);
  const rest = CLASS_ORDER.filter((c) => c !== current);
  if (level >= 10 && rest[0]) unlocked.push(rest[0]);
  if (level >= 15 && rest[1]) unlocked.push(rest[1]);
  return unlocked.length ? unlocked : [CLASS_ORDER[0]];
}

// Active class first, remaining unlocked classes after (for the filter tabs).
function orderedClassTabs(user) {
  const unlocked = getUnlockedClasses(user);
  const active = String(user?.class_name || '').trim().toLowerCase();
  return [...new Set([active, ...unlocked].filter((c) => unlocked.includes(c)))];
}

const SLOT_ICON = { weapon: Sword, armor: Shield, helmet: HardHat, ability: Sparkles, ability_2: Sparkles };

// Skill items unlock by level: first skill at 5, second skill at 3.
function skillLevelReq(slot) {
  if (slot === 'ability_2') return 3;
  if (slot === 'ability') return 5;
  return null;
}

function rarityRingClass(item) {
  const tier = getTierKey(item);
  if (tier === 'legendary') return 'rarity-ring-legendary';
  if (tier === 'epic') return 'rarity-ring-epic';
  if (tier === 'rare') return 'rarity-ring-rare';
  if (tier === 'uncommon') return 'rarity-ring-uncommon';
  return '';
}

// Compact tile artwork — mirrors InventoryScreen's GridItemImage so shop + inventory
// share one visual language.
function GridItemImage({ item, FallbackIcon, theme, size = 46 }) {
  const [failed, setFailed] = useState(false);
  const src = getItemImageSrc(item);
  const slot = getSlotKey(item);
  const imagePath = item?.image_path;

  useEffect(() => { setFailed(false); }, [src]);

  if (slot === 'weapon' && imagePath && !failed) {
    return <WeaponIcon imagePath={imagePath} size={size} borderRadius={8} />;
  }
  if ((slot === 'armor' || slot === 'helmet') && imagePath && !failed) {
    return <ArmorIcon imagePath={imagePath} size={size} borderRadius={8} />;
  }
  if (!src || failed) {
    return <FallbackIcon style={{ width: '46%', height: '46%', color: theme.color }} />;
  }
  return (
    <img
      src={src}
      alt={item.name}
      className={rarityRingClass(item)}
      style={{ width: '80%', height: '80%', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: 8 }}
      onError={() => setFailed(true)}
    />
  );
}

// Bigger artwork for the detail sheet.
function ModalItemImage({ item, size = 78 }) {
  const [failed, setFailed] = useState(false);
  const theme = getTierTheme(item);
  const src = getItemImageSrc(item);
  const slot = getSlotKey(item);
  const Icon = SLOT_ICON[slot] || Sword;
  const imagePath = item?.image_path;

  const frame = {
    width: size, height: size, borderRadius: 18, flexShrink: 0, overflow: 'hidden',
    border: `2px solid ${theme.border}`, boxShadow: `0 0 14px ${theme.glow}`,
  };

  if (slot === 'weapon' && imagePath && !failed) {
    return <div style={frame}><WeaponIcon imagePath={imagePath} size={size} borderRadius={0} /></div>;
  }
  if ((slot === 'armor' || slot === 'helmet') && imagePath && !failed) {
    return <div style={frame}><ArmorIcon imagePath={imagePath} size={size} borderRadius={0} /></div>;
  }
  if (!src || failed) {
    return (
      <div style={{ ...frame, background: theme.soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={Math.round(size * 0.45)} color={theme.color} />
      </div>
    );
  }
  return (
    <img src={src} alt={item.name} onError={() => setFailed(true)}
      style={{ ...frame, objectFit: 'cover' }} />
  );
}

function MetaChip({ children, color, background, border }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999,
      letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      color, background, border: `1px solid ${border || 'transparent'}`,
    }}>
      {children}
    </span>
  );
}

function buyState({ item, user, balance, owned }) {
  const price = Number(item.price || 0);
  const itemClass = getClassKey(item);
  const userClass = String(user?.class_name || '').trim().toLowerCase();
  const slot = getSlotKey(item);
  const levelReq = skillLevelReq(slot);
  const userLevel = user?.level ?? 99;
  const classMismatch = Boolean(userClass && itemClass && itemClass !== 'any' && userClass !== itemClass);
  const levelLocked = levelReq !== null && userLevel < levelReq;
  const canAfford = balance >= price;
  return { price, itemClass, slot, levelReq, classMismatch, levelLocked, canAfford };
}

// ── Detail / buy sheet ───────────────────────────────────────────────────────
function ShopItemModal({ item, user, balance, owned, buying, onBuy, onClose }) {
  if (!item) return null;

  const theme = getTierTheme(item);
  const { price, itemClass, slot, levelReq, classMismatch, levelLocked, canAfford } = buyState({ item, user, balance, owned });
  const classTheme = CLASS_THEME[itemClass] || null;
  const statRows = getItemStatRows(item);
  const abilityRows = getAbilityBattleRows(item, {
    abilityBonus: Number(item?.effective_stats?.ability_bonus || item?.ability_bonus || 0),
  });
  const passiveText = getPassiveText(item);
  const isBuying = buying === item.id;
  const disabled = classMismatch || !canAfford || isBuying || owned || levelLocked;

  const label = owned
    ? 'Already owned'
    : levelLocked
    ? `Unlocks at level ${levelReq}`
    : classMismatch
    ? `${formatClassLabel(itemClass)} class only`
    : isBuying
    ? 'Buying…'
    : !canAfford
    ? `Need ${(price - balance).toLocaleString()} more coins`
    : `Buy — ${price.toLocaleString()} coins`;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
    >
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
        maxHeight: '85vh', overflowY: 'auto',
        background: 'linear-gradient(180deg, rgba(13,13,26,0.99) 0%, rgba(26,26,46,0.99) 100%)',
        borderTop: `2px solid ${theme.border}`, borderRadius: '24px 24px 0 0',
      }}>
        <div style={{ height: 3, background: `linear-gradient(90deg, ${theme.color}, transparent)`, borderRadius: '24px 24px 0 0' }} />

        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16, width: 32, height: 32, borderRadius: 8,
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94a3b8', padding: 0,
        }}>
          <X size={16} />
        </button>

        <div style={{ padding: 20 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ModalItemImage item={item} size={78} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#e8e0d0', lineHeight: 1.2, wordBreak: 'break-word' }}>
                  {item.name}
                </span>
                {owned && (
                  <MetaChip color="#86efac" background="rgba(34,197,94,0.16)" border="rgba(34,197,94,0.35)">Owned</MetaChip>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                <MetaChip color={theme.color} background={theme.soft} border={theme.border}>{getTierLabel(item)}</MetaChip>
                <MetaChip color="#cbd5e1" background="rgba(255,255,255,0.05)" border="rgba(255,255,255,0.08)">{formatSlotLabel(slot)}</MetaChip>
                {classTheme && (
                  <MetaChip color={classTheme.color} background={classTheme.bg} border="transparent">{formatClassLabel(itemClass)}</MetaChip>
                )}
                {levelReq !== null && (
                  <MetaChip color="#c084fc" background="rgba(192,132,252,0.14)" border="rgba(192,132,252,0.3)">Lv.{levelReq}</MetaChip>
                )}
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '16px 0' }} />

          {/* Stats */}
          {statRows.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em', color: theme.color, marginBottom: 8 }}>Stats</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {statRows.map((row) => (
                  <div key={row.key} style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8, padding: '7px 10px', fontSize: 11, fontWeight: 700, color: theme.color,
                  }}>
                    {row.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {abilityRows.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#60a5fa', marginBottom: 8 }}>Skill</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {abilityRows.map((row) => (
                  <div key={row.key} style={{
                    background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.18)',
                    borderRadius: 8, padding: '7px 10px', fontSize: 11, fontWeight: 700, color: '#93c5fd',
                  }}>
                    {row.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {passiveText && (
            <div style={{ background: theme.soft, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em', color: theme.color }}>Passive</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginTop: 4, lineHeight: 1.5 }}>{passiveText}</div>
            </div>
          )}

          {/* Buy */}
          <button
            onClick={() => onBuy(item)}
            disabled={disabled}
            style={{
              width: '100%', height: 46, borderRadius: 14, fontWeight: 900, fontSize: 14,
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: disabled
                ? 'rgba(255,255,255,0.04)'
                : 'linear-gradient(135deg, #7a5a10, #c9a84c)',
              border: disabled ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(201,168,76,0.4)',
              color: disabled ? '#64748b' : '#0a0a0a',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.15s ease',
            }}
          >
            {(levelLocked || classMismatch) && !owned && <Lock size={14} />}
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShopScreen({ user, onInventoryChanged }) {
  const [items, setItems] = useState(null);
  // owned-by-type, used so "Owned" shows reliably regardless of catalog id shape
  const [ownedKeys, setOwnedKeys] = useState(new Set());
  const [buying, setBuying] = useState(null);
  const [balance, setBalance] = useState(user?.token_balance || 0);
  const [tierFilter, setTierFilter] = useState('common');
  const classTabs = useMemo(() => orderedClassTabs(user), [user?.unlocked_classes, user?.class_name, user?.level]);
  const [classFilter, setClassFilter] = useState(() => orderedClassTabs(user)[0]);
  const [slotFilter, setSlotFilter] = useState('all'); // 'all' | 'gear' | 'skills'
  const [selected, setSelected] = useState(null);

  useEffect(() => { setBalance(user?.token_balance || 0); }, [user?.token_balance]);

  // Keep the selected class valid as classes unlock / the active class changes.
  useEffect(() => {
    if (!classTabs.includes(classFilter)) setClassFilter(classTabs[0]);
  }, [classTabs, classFilter]);

  useEffect(() => {
    apiClient.get('/shop/items')
      .then((r) => setItems(r.data?.items || r.data || []))
      .catch(() => setItems([]));

    apiClient.get('/inventory')
      .then((r) => {
        const inv = Array.isArray(r.data) ? r.data : (r.data?.items || []);
        const keys = new Set();
        inv.forEach((it) => {
          if (it.type_key) keys.add(it.type_key);
          if (it.name) keys.add(it.name);
          if (it.item_id != null) keys.add(`id:${it.item_id}`);
        });
        setOwnedKeys(keys);
      })
      .catch(() => {});
  }, []);

  const isOwned = (item) =>
    ownedKeys.has(item.type_key) ||
    ownedKeys.has(item.name) ||
    ownedKeys.has(`id:${item.id}`) ||
    ownedKeys.has(`id:${item.item_id}`);

  const visibleItems = useMemo(() => (items || []).filter((item) => {
    if (getTierKey(item) !== tierFilter) return false;
    const itemClass = getClassKey(item);
    // Universal ('any', e.g. helmets) always show; otherwise must match the selected class.
    if (itemClass !== 'any' && itemClass !== classFilter) return false;
    const itemSlot = item.slot;
    if (slotFilter === 'skills') {
      if (itemSlot !== 'ability' && itemSlot !== 'ability_2') return false;
    } else if (slotFilter === 'gear') {
      if (itemSlot !== 'weapon' && itemSlot !== 'armor' && itemSlot !== 'helmet') return false;
    }
    return true;
  }), [items, tierFilter, classFilter, slotFilter]);

  const userClass = String(user?.class_name || '').trim().toLowerCase();

  const handleBuy = async (item) => {
    if (buying) return;
    setBuying(item.id);
    try {
      const response = await apiClient.post('/shop/buy', { item_id: item.id });
      const key = item.type_key || item.name;
      setOwnedKeys((prev) => {
        const next = new Set(prev);
        if (key) next.add(key);
        if (item.id != null) next.add(`id:${item.id}`);
        return next;
      });
      if (response.data?.new_balance != null) setBalance(response.data.new_balance);
      onInventoryChanged?.({ newBalance: response.data?.new_balance ?? null });
      toast.success(`Purchased ${item.name}`);
      setSelected(null);
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
        background: 'rgba(10,10,22,0.97)', border: '1px solid rgba(201,168,76,0.2)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      }}>
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

        {/* Class row — only unlocked classes; hidden entirely when just one is unlocked */}
        {classTabs.length > 1 && (
          <div style={{ display: 'flex', gap: 5 }}>
            {classTabs.map((cls) => {
              const active = classFilter === cls;
              const isYou = cls === userClass;
              const theme = CLASS_THEME[cls] || { bg: 'rgba(255,255,255,0.06)', color: '#cbd5e1' };
              return (
                <button key={cls} type="button" onClick={() => setClassFilter(cls)} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  borderRadius: 10, padding: '7px 4px',
                  border: active
                    ? `1px solid ${isYou ? 'rgba(201,168,76,0.55)' : theme.color + '66'}`
                    : '1px solid rgba(255,255,255,0.06)',
                  background: active ? (isYou ? 'rgba(201,168,76,0.12)' : theme.bg) : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>{CLASS_ICON[cls]}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: active ? (isYou ? '#c9a84c' : theme.color) : '#475569',
                  }}>
                    {formatClassLabel(cls)}{isYou ? ' ✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Slot filter row */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'gear', label: 'Gear' },
            { key: 'skills', label: 'Skills' },
          ].map(({ key, label }) => {
            const active = slotFilter === key;
            return (
              <button key={key} type="button" onClick={() => setSlotFilter(key)} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                borderRadius: 10, padding: '7px 4px',
                border: active ? '1px solid rgba(147,197,253,0.45)' : '1px solid rgba(255,255,255,0.06)',
                background: active ? 'rgba(147,197,253,0.1)' : 'rgba(255,255,255,0.03)',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: active ? '#93c5fd' : '#475569' }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Item grid ─────────────────────────────────────────── */}
      {items === null ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <div key={i} className="animate-pulse" style={{ aspectRatio: '1 / 1', borderRadius: 14, background: 'rgba(26,26,46,0.55)', border: '1px solid rgba(201,168,76,0.08)' }} />
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <div style={{ borderRadius: 18, padding: '28px 16px', textAlign: 'center', background: 'rgba(26,26,46,0.72)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <Filter style={{ width: 26, height: 26, color: '#334155', margin: '0 auto 10px' }} />
          <p style={{ color: '#94a3b8', fontWeight: 900, fontSize: 13, margin: 0 }}>No gear in this filter</p>
          <p style={{ color: '#475569', fontSize: 11, margin: '4px 0 0' }}>Try another tier or class.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 }}>
          {visibleItems.map((item) => {
            const theme = getTierTheme(item);
            const slot = getSlotKey(item);
            const FallbackIcon = SLOT_ICON[slot] || Sword;
            const owned = isOwned(item);
            const { price, levelReq, classMismatch, levelLocked, canAfford } = buyState({ item, user, balance, owned });
            const locked = levelLocked || classMismatch;
            const dimmed = (!owned && !canAfford) || locked;

            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelected(item)}
                title={item.name}
                aria-label={`${item.name}, ${price} coins${owned ? ', owned' : ''}`}
                style={{
                  position: 'relative', aspectRatio: '1 / 1', borderRadius: 14, overflow: 'hidden',
                  cursor: 'pointer', padding: 5, appearance: 'none', color: 'inherit',
                  background: 'linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(10,14,28,0.98) 100%)',
                  border: owned ? '1.5px solid rgba(34,197,94,0.5)' : `1px solid ${theme.border}`,
                  boxShadow: owned ? '0 0 14px rgba(34,197,94,0.18)' : `0 0 12px ${theme.glow}`,
                  opacity: dimmed ? 0.62 : 1, transition: 'all 0.15s ease',
                }}
              >
                <div style={{
                  width: '100%', height: '100%', position: 'relative', borderRadius: 10,
                  border: `1px solid ${theme.border}`,
                  background: `radial-gradient(circle at 50% 30%, ${theme.soft} 0%, rgba(8,12,24,0.95) 62%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  <GridItemImage item={item} FallbackIcon={FallbackIcon} theme={theme} size={44} />

                  {/* rarity dot */}
                  <div style={{
                    position: 'absolute', left: 5, top: 5, width: 8, height: 8, borderRadius: 999,
                    background: theme.color, border: '1px solid rgba(0,0,0,0.45)', boxShadow: `0 0 8px ${theme.glow}`,
                  }} />

                  {/* top-right: owned ✓ or level badge */}
                  {owned ? (
                    <div style={{
                      position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 900, lineHeight: 1,
                      color: '#0a0a0a', background: '#4ade80', borderRadius: 999, padding: '2px 5px',
                    }}>✓</div>
                  ) : levelReq !== null ? (
                    <div style={{
                      position: 'absolute', top: 4, right: 4, fontSize: 8, fontWeight: 900, lineHeight: 1.3,
                      color: '#c084fc', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(192,132,252,0.4)',
                      borderRadius: 999, padding: '2px 4px',
                    }}>Lv{levelReq}</div>
                  ) : null}

                  {/* lock for level/class gating */}
                  {locked && !owned && (
                    <div style={{
                      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                      width: 24, height: 24, borderRadius: 999, background: 'rgba(0,0,0,0.6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Lock size={13} style={{ color: '#cbd5e1' }} />
                    </div>
                  )}

                  {/* price strip */}
                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, padding: '3px 4px',
                    background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.78))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {owned ? (
                      <span style={{ fontSize: 9, fontWeight: 900, color: '#86efac', letterSpacing: '0.04em' }}>OWNED</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 900, color: canAfford ? '#f0c454' : '#9a6b6b', lineHeight: 1 }}>
                        {price.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <ShopItemModal
          item={selected}
          user={user}
          balance={balance}
          owned={isOwned(selected)}
          buying={buying}
          onBuy={handleBuy}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
