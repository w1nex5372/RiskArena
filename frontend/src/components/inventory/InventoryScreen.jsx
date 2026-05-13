import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Backpack, BatteryCharging, Gem, Shield, ShoppingBag, Sparkles, Sword } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import ShopScreen from '../shop/ShopScreen';
import apiClient from '../../api/client';
import {
  CLASS_THEME,
  TIER_ORDER,
  formatClassLabel,
  formatSlotLabel,
  getClassKey,
  getItemImageSrc,
  getItemStatRows,
  getPassiveText,
  getStatEntries,
  getSlotKey,
  getTierKey,
  getTierLabel,
  getTierTheme,
} from '../../utils/itemPresentation';

const HUB_TABS = [
  { key: 'loadout', label: 'Loadout', helper: 'Equip one item per slot', cta: 'Manage', Icon: Backpack },
  { key: 'shop', label: 'Shop', helper: 'Browse all class gear', cta: 'Browse', Icon: ShoppingBag },
  { key: 'upgrade', label: 'Upgrade', helper: 'Enchant owned copies', cta: 'Enchant', Icon: Gem },
];

const TABS = ['Weapon', 'Armor', 'Ability', 'Consumables'];

const TAB_CATEGORY = {
  Weapon: 'weapon',
  Armor: 'armor',
  Ability: 'ability',
  Consumables: 'consumable',
};

const TAB_ICON = {
  Weapon: Sword,
  Armor: Shield,
  Ability: Sparkles,
  Consumables: BatteryCharging,
};

const LOADOUT_SLOTS = [
  { key: 'weapon', label: 'Weapon', Icon: Sword },
  { key: 'armor', label: 'Armor', Icon: Shield },
  { key: 'ability', label: 'Ability', Icon: Sparkles },
];

const SCROLL_OPTIONS = [
  {
    key: 'normal_scroll',
    label: 'Normal scroll',
    shortLabel: 'Normal',
    note: 'Can destroy the item above safe range.',
  },
  {
    key: 'blessed_scroll',
    label: 'Blessed scroll',
    shortLabel: 'Blessed',
    note: 'Failure keeps the item copy.',
  },
];

function ItemImage({ item, size = 52 }) {
  const [failed, setFailed] = useState(false);
  const theme = getTierTheme(item);
  const src = getItemImageSrc(item);
  const slot = getSlotKey(item);
  const Icon = TAB_ICON[formatSlotLabel(slot)] || Sword;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 14,
          flexShrink: 0,
          background: 'rgba(255,255,255,0.04)',
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
      alt={item?.name || 'Item'}
      style={{
        width: size,
        height: size,
        borderRadius: 14,
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
        fontWeight: 800,
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
        fontWeight: 700,
        color,
        padding: '4px 8px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {label}
    </span>
  );
}

function StatGroup({ title, rows, color, emptyText = null, limit = 4 }) {
  const visibleRows = (rows || []).filter(Boolean).slice(0, limit);
  if (!visibleRows.length && !emptyText) return null;
  return (
    <div
      style={{
        borderRadius: 12,
        padding: '8px 9px',
        background: 'rgba(255,255,255,0.035)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <p style={{ color: '#64748b', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
        {title}
      </p>
      {visibleRows.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          {visibleRows.map((row) => (
            <StatChip key={`${title}-${row.key || row.stat || row.label}`} label={row.label} color={color} />
          ))}
        </div>
      ) : (
        <p style={{ color: '#64748b', fontSize: 11, fontWeight: 700, margin: '5px 0 0' }}>{emptyText}</p>
      )}
    </div>
  );
}

function EnchantBadge({ item }) {
  const level = Number(item?.enchant_level || 0);
  const slot = getSlotKey(item);
  if (!['weapon', 'armor'].includes(slot) && level <= 0) return null;
  return (
    <MetaChip style={{ color: '#c9a84c', background: 'rgba(201,168,76,0.14)', border: '1px solid rgba(201,168,76,0.24)' }}>
      +{level} enchant
    </MetaChip>
  );
}

function LoadoutCard({ slot, item, onTabJump }) {
  const theme = item ? getTierTheme(item) : null;
  const passiveText = getPassiveText(item);
  const statChips = item ? getItemStatRows(item).slice(0, 3) : [];
  const enchantRows = item ? getItemStatRows(item, { source: 'enchant_stats' }) : [];

  if (!item) {
    return (
      <button
        type="button"
        onClick={() => onTabJump(slot.label)}
        style={{
          borderRadius: 18,
          padding: 12,
          textAlign: 'left',
          border: '1px dashed rgba(148,163,184,0.34)',
          background: 'rgba(15,23,42,0.22)',
          boxShadow: 'none',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              flexShrink: 0,
              background: 'rgba(2,6,23,0.32)',
              border: '1px dashed rgba(148,163,184,0.32)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#64748b', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              None
            </span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', margin: 0 }}>
              {slot.label}
            </p>
            <p style={{ color: '#94a3b8', fontWeight: 900, fontSize: 13, margin: '4px 0 0' }}>
              Empty slot
            </p>
            <p style={{ color: '#475569', fontSize: 11, fontWeight: 700, margin: '4px 0 0' }}>
              Tap to show {slot.label.toLowerCase()} inventory.
            </p>
          </div>
          <MetaChip style={{ color: '#64748b', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            Empty
          </MetaChip>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onTabJump(slot.label)}
      style={{
        borderRadius: 18,
        padding: 12,
        textAlign: 'left',
        border: `1px solid ${theme.border}`,
        background: `linear-gradient(135deg, rgba(15,23,42,0.92) 0%, ${theme.soft} 100%)`,
        boxShadow: `0 0 18px ${theme.glow}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ItemImage item={item} size={46} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.color, margin: 0 }}>
            {slot.label}
          </p>
          <p
            style={{
              color: '#e8e0d0',
              fontWeight: 800,
              fontSize: 13,
              margin: '4px 0 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.name}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
        <MetaChip style={{ color: theme.color, background: theme.soft, border: `1px solid ${theme.border}` }}>
          {getTierLabel(item)}
        </MetaChip>
        <MetaChip style={{ color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {formatClassLabel(getClassKey(item))}
        </MetaChip>
        <EnchantBadge item={item} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {statChips.map((chip) => (
          <StatChip key={chip.key} label={chip.label} color={theme.color} />
        ))}
      </div>
      {enchantRows.length ? (
        <p style={{ color: '#c9a84c', fontSize: 11, fontWeight: 800, margin: '8px 0 0' }}>
          Enchant bonus: {enchantRows.map((row) => row.label).join(', ')}
        </p>
      ) : null}
      {passiveText ? (
        <p style={{ color: theme.color, fontSize: 11, fontWeight: 700, margin: '10px 0 0' }}>
          Passive: {passiveText}
        </p>
      ) : null}
    </button>
  );
}

function chancePercent(value) {
  if (value == null) return '--';
  return `${Math.round(Number(value) * 100)}%`;
}

function ScrollImage({ scroll, selected }) {
  return (
    <img
      src={getItemImageSrc({ scroll_type: scroll.key })}
      alt={scroll.label}
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        objectFit: 'cover',
        border: selected ? '1px solid rgba(201,168,76,0.45)' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: selected ? '0 0 14px rgba(201,168,76,0.18)' : 'none',
        flexShrink: 0,
      }}
    />
  );
}

function UpgradeItemRow({ item, selected, onSelect }) {
  const theme = getTierTheme(item);
  const level = Number(item.enchant_level || 0);
  const max = Number(item.max_enchant || 0);

  return (
    <button
      type="button"
      onClick={() => onSelect(item.inventory_id)}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: 18,
        padding: 12,
        border: selected ? '1px solid rgba(201,168,76,0.55)' : `1px solid ${theme.border}`,
        background: selected
          ? `linear-gradient(135deg, rgba(42,30,8,0.95) 0%, ${theme.soft} 100%)`
          : 'rgba(26,26,46,0.82)',
        boxShadow: selected ? '0 0 20px rgba(201,168,76,0.16)' : `0 0 14px ${theme.glow}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <ItemImage item={item} size={48} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <p
              style={{
                color: '#e8e0d0',
                fontSize: 13,
                fontWeight: 900,
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </p>
            <span style={{ color: '#c9a84c', fontWeight: 900, fontSize: 15, flexShrink: 0 }}>+{level}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
            <MetaChip style={{ color: theme.color, background: theme.soft, border: `1px solid ${theme.border}` }}>
              {getTierLabel(item)}
            </MetaChip>
            <MetaChip style={{ color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {formatSlotLabel(getSlotKey(item))}
            </MetaChip>
            {item.equipped ? (
              <MetaChip style={{ color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.22)' }}>
                Equipped
              </MetaChip>
            ) : null}
            {max && level >= max ? (
              <MetaChip style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                Max
              </MetaChip>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function InventoryScreen({ user }) {
  const [hubTab, setHubTab] = useState('loadout');
  const [activeTab, setActiveTab] = useState('Weapon');
  const inventoryListRef = useRef(null);
  const [displayBalance, setDisplayBalance] = useState(user?.token_balance || 0);
  const [inventory, setInventory] = useState(null);
  const [equippedInventoryIds, setEquippedInventoryIds] = useState(new Set());
  const [equippedBySlot, setEquippedBySlot] = useState({ weapon: null, armor: null, ability: null });
  const [loadoutEffectiveStats, setLoadoutEffectiveStats] = useState({});
  const [upgradeItems, setUpgradeItems] = useState([]);
  const [scrolls, setScrolls] = useState({ normal_scroll: 0, blessed_scroll: 0 });
  const [scrollShop, setScrollShop] = useState([]);
  const [selectedUpgradeId, setSelectedUpgradeId] = useState(null);
  const [selectedScroll, setSelectedScroll] = useState('normal_scroll');
  const [enchanting, setEnchanting] = useState(false);
  const [buyingScroll, setBuyingScroll] = useState(null);
  const [enchantResult, setEnchantResult] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [equipping, setEquipping] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setDisplayBalance(user?.token_balance || 0);
  }, [user?.token_balance]);

  const applyEquippedState = useCallback((data) => {
    const equippedItems = data?.equipped_items || (Array.isArray(data) ? data : []);
    const equipped = data?.equipped || {};
    setEquippedInventoryIds(new Set(equippedItems.map((item) => item.inventory_id).filter(Boolean)));
    setEquippedBySlot({
      weapon: equipped.weapon || null,
      armor: equipped.armor || null,
      ability: equipped.ability || null,
    });
    setLoadoutEffectiveStats(data?.loadout_effective_stats || {});
  }, []);

  const refreshItems = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setInventory(null);
      setLoadError(false);
    }

    const [inventoryResponse, equippedResponse, upgradeResponse, scrollShopResponse] = await Promise.all([
      apiClient.get('/inventory'),
      apiClient.get('/me/equipped').catch(() => ({ data: {} })),
      apiClient.get('/me/upgrade').catch(() => ({ data: { items: [], scrolls: {} } })),
      apiClient.get('/shop/scrolls').catch(() => ({ data: { scrolls: [] } })),
    ]);

    const items = Array.isArray(inventoryResponse.data) ? inventoryResponse.data : inventoryResponse.data?.items ?? [];
    const nextUpgradeItems = upgradeResponse.data?.items || [];

    setInventory(items);
    applyEquippedState(equippedResponse.data);
    setUpgradeItems(nextUpgradeItems);
    setScrolls(upgradeResponse.data?.scrolls || {});
    setScrollShop(scrollShopResponse.data?.scrolls || []);
    setSelectedUpgradeId((current) => {
      if (current && nextUpgradeItems.some((item) => item.inventory_id === current)) return current;
      return nextUpgradeItems[0]?.inventory_id || null;
    });
  }, [applyEquippedState]);

  useEffect(() => {
    let cancelled = false;
    setInventory(null);
    setLoadError(false);

    refreshItems({ showLoading: true }).catch(() => {
      if (!cancelled) setLoadError(true);
    });

    return () => {
      cancelled = true;
    };
  }, [refreshItems, retryKey]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') {
        refreshItems().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', refreshOnFocus);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      document.removeEventListener('visibilitychange', refreshOnFocus);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [refreshItems]);

  const handleEquip = async (item) => {
    if (equipping) return;
    setEquipping(item.inventory_id);
    try {
      await apiClient.post('/me/equip', { inventory_id: item.inventory_id });
      toast.success(`${item.name} equipped`);
      await refreshItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to equip item');
    } finally {
      setEquipping(null);
    }
  };

  const handleEnchant = async () => {
    const item = upgradeItems.find((candidate) => candidate.inventory_id === selectedUpgradeId);
    if (!item || enchanting) return;

    setEnchanting(true);
    try {
      const response = await apiClient.post('/me/enchant', {
        inventory_id: item.inventory_id,
        scroll_type: selectedScroll,
      });
      setEnchantResult({ ...response.data, item_name: item.name });
      if (response.data?.destroyed) {
        toast.error(`${item.name} was destroyed`);
      } else if (response.data?.success) {
        toast.success(`${item.name} enchanted to +${response.data.new_enchant_level}`);
      } else {
        toast.error(`${item.name} enchant failed`);
      }
      await refreshItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Enchant failed');
    } finally {
      setEnchanting(false);
    }
  };

  const handleBuyScroll = async (scroll) => {
    if (buyingScroll) return;
    setBuyingScroll(scroll.scroll_type);
    try {
      const response = await apiClient.post('/shop/scrolls/buy', { scroll_type: scroll.scroll_type, quantity: 1 });
      if (response.data?.new_balance != null) {
        setDisplayBalance(response.data.new_balance);
      }
      toast.success(`Purchased ${scroll.name || scroll.label || 'scroll'}`);
      await refreshItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Scroll purchase failed');
    } finally {
      setBuyingScroll(null);
    }
  };

  const jumpToInventorySlot = useCallback((tab) => {
    setActiveTab(tab);
    window.requestAnimationFrame(() => {
      inventoryListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const matchCategory = (category, tab) => {
    const normalized = String(category || '').trim().toLowerCase();
    const key = TAB_CATEGORY[tab];
    return normalized === key || normalized.startsWith(key);
  };

  const userClass = String(user?.class_name || '').trim().toLowerCase();
  const loadoutPowerSummary = useMemo(() => {
    return getStatEntries(loadoutEffectiveStats);
  }, [loadoutEffectiveStats]);

  const duplicateIndexByInventoryId = useMemo(() => {
    const byItem = new Map();
    const result = new Map();

    (inventory || []).forEach((item) => {
      const itemId = item.item_id;
      if (!itemId) return;
      const list = byItem.get(itemId) || [];
      list.push(item);
      byItem.set(itemId, list);
    });

    byItem.forEach((list) => {
      list.forEach((item, index) => {
        result.set(item.inventory_id, { index: index + 1, total: list.length });
      });
    });

    return result;
  }, [inventory]);

  const sortedTabItems = useMemo(() => {
    const filtered = (inventory || []).filter((item) => matchCategory(item.category || item.type, activeTab));
    return [...filtered].sort((a, b) => {
      const tierDelta = TIER_ORDER.indexOf(getTierKey(b)) - TIER_ORDER.indexOf(getTierKey(a));
      if (tierDelta !== 0) return tierDelta;
      return new Date(b.acquired_at || 0).getTime() - new Date(a.acquired_at || 0).getTime();
    });
  }, [inventory, activeTab]);

  const selectedUpgradeItem = useMemo(
    () => upgradeItems.find((item) => item.inventory_id === selectedUpgradeId) || null,
    [upgradeItems, selectedUpgradeId],
  );

  const selectedScrollCount = Number(scrolls[selectedScroll] || 0);
  const selectedScrollShopItem = scrollShop.find((scroll) => scroll.scroll_type === selectedScroll);
  const selectedChance = selectedUpgradeItem
    ? selectedUpgradeItem.next_enchant_preview?.[selectedScroll]?.success_chance
      ?? (selectedScroll === 'blessed_scroll'
        ? selectedUpgradeItem.blessed_success_chance
        : selectedUpgradeItem.normal_success_chance)
    : null;
  const selectedPreview = selectedUpgradeItem?.next_enchant_preview?.[selectedScroll] || null;
  const selectedLevel = Number(selectedUpgradeItem?.enchant_level || 0);
  const selectedMax = Number(selectedUpgradeItem?.max_enchant || 0);
  const hasGuaranteedSuccess = selectedUpgradeItem && Number(selectedChance) >= 1;
  const isAtMax = selectedUpgradeItem && selectedMax && selectedLevel >= selectedMax;
  const normalDestroyRisk = selectedUpgradeItem && selectedScroll === 'normal_scroll' && Boolean(selectedPreview?.can_destroy ?? Number(selectedChance) < 1);
  const ActiveIcon = TAB_ICON[activeTab];

  if (loadError) {
    return (
      <div className="space-y-4" style={{ color: '#e8e0d0' }}>
        <div className="rounded-[24px] p-6 text-center" style={{ background: 'rgba(26,26,46,0.9)', border: '1px solid rgba(139,0,0,0.3)' }}>
          <p className="text-sm font-bold mb-3" style={{ color: '#ef4444' }}>Failed to load items.</p>
          <Button
            onClick={() => setRetryKey((key) => key + 1)}
            style={{ background: 'linear-gradient(135deg,#8b0000,#c0392b)', color: 'white', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 12, fontWeight: 800 }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" style={{ color: '#e8e0d0' }}>
      <section
        className="rounded-[22px] p-3"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'linear-gradient(135deg, rgba(8,8,15,0.99), rgba(26,26,46,0.99))',
          border: '1px solid rgba(201,168,76,0.34)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.48)',
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p style={{ color: '#c9a84c', fontSize: 11, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
              Items
            </p>
            <p style={{ color: '#e8e0d0', fontSize: 15, fontWeight: 900, margin: '3px 0 0' }}>
              {hubTab === 'loadout' ? 'Manage equipped gear' : hubTab === 'shop' ? 'Browse class gear' : 'Enchant owned copies'}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: '#64748b', fontSize: 10, fontWeight: 800, margin: 0 }}>Coins</p>
            <p style={{ color: '#c9a84c', fontSize: 14, fontWeight: 900, margin: '1px 0 0' }}>
              {Number(displayBalance || 0).toLocaleString()}
            </p>
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 8,
          }}
        >
          {HUB_TABS.map(({ key, label, helper, cta, Icon }) => {
            const active = hubTab === key;
            return (
            <button
              key={key}
              type="button"
              onClick={() => setHubTab(key)}
              style={{
                minHeight: 58,
                borderRadius: 14,
                padding: '9px 11px',
                fontSize: 12,
                fontWeight: 900,
                border: active ? '1px solid rgba(201,168,76,0.48)' : '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
                background: active
                  ? 'linear-gradient(135deg,#8b0000 0%, #c0392b 100%)'
                  : 'rgba(255,255,255,0.035)',
                color: active ? 'white' : '#cbd5e1',
                boxShadow: active ? '0 8px 18px rgba(139,0,0,0.35)' : 'none',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: active ? 'rgba(255,255,255,0.15)' : 'rgba(201,168,76,0.08)',
                    border: active ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(201,168,76,0.12)',
                  }}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', lineHeight: 1.1 }}>{label}</span>
                  <span style={{ display: 'block', color: active ? 'rgba(255,255,255,0.72)' : '#64748b', fontSize: 10, fontWeight: 800, marginTop: 2 }}>
                    {helper}
                  </span>
                </span>
              </span>
              <span style={{ flexShrink: 0, color: active ? '#0a0a0a' : '#c9a84c', background: active ? '#c9a84c' : 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.24)', borderRadius: 999, padding: '5px 8px', fontSize: 10, fontWeight: 950, textTransform: 'uppercase' }}>
                {active ? 'Active' : cta}
              </span>
            </button>
          );
          })}
        </div>
      </section>

      <section className="rounded-[20px] p-3" style={{ background: 'rgba(13,13,26,0.72)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#c9a84c' }}>
              {hubTab === 'loadout' ? 'Loadout' : hubTab === 'shop' ? 'Shop' : 'Upgrade'}
            </p>
            <p className="text-sm font-bold mt-1" style={{ color: '#e8e0d0' }}>
              {hubTab === 'loadout' ? 'Equipped gear and owned inventory' : hubTab === 'shop' ? 'Purchasable class gear' : 'Enchant weapon and armor copies'}
            </p>
            <p className="text-xs mt-1" style={{ color: '#64748b' }}>
              {hubTab === 'shop' ? 'Filter by tier and class. Other class gear is shown as future class options.' : hubTab === 'upgrade' ? 'Only weapon and armor copies can be enchanted.' : 'Tap a slot to show matching owned items.'}
            </p>
          </div>
          <MetaChip style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Lv {user?.level || 1}
          </MetaChip>
        </div>
      </section>

      {hubTab === 'shop' ? (
        <ShopScreen
          user={user}
          onInventoryChanged={({ newBalance } = {}) => {
            if (newBalance != null) {
              setDisplayBalance(newBalance);
            }
            return refreshItems().catch(() => {});
          }}
        />
      ) : null}

      {hubTab === 'loadout' ? (
        <>
          <section className="rounded-[24px] p-4" style={{ background: 'rgba(13,13,26,0.96)', border: '1px solid rgba(201,168,76,0.16)' }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#c9a84c' }}>Active Loadout</p>
                <p className="text-xs font-medium mt-1" style={{ color: '#64748b' }}>One equipped copy per slot. Combat values come from backend item stats.</p>
              </div>
              <MetaChip style={{ color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.22)' }}>
                {loadoutPowerSummary.length} bonuses
              </MetaChip>
            </div>

            <div className="grid gap-3">
              {LOADOUT_SLOTS.map((slot) => (
                <LoadoutCard
                  key={slot.key}
                  slot={slot}
                  item={equippedBySlot[slot.key]}
                  onTabJump={jumpToInventorySlot}
                />
              ))}
            </div>

            {loadoutPowerSummary.length ? (
              <div className="mt-3">
                <StatGroup title="Equipped total" rows={loadoutPowerSummary} color="#c9a84c" limit={6} />
              </div>
            ) : null}
          </section>

          <section ref={inventoryListRef} className="rounded-[24px] p-3 scroll-mt-3" style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(201,168,76,0.15)' }}>
            <div className="grid grid-cols-4 gap-1 rounded-2xl p-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
              {TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    borderRadius: 10,
                    padding: '6px 4px',
                    fontSize: 11,
                    fontWeight: 800,
                    border: 'none',
                    cursor: 'pointer',
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

          <section className="space-y-3">
            {inventory === null ? (
              [1, 2, 3].map((index) => (
                <div key={index} className="rounded-[22px] p-4 h-32 animate-pulse" style={{ background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(201,168,76,0.1)' }} />
              ))
            ) : sortedTabItems.length === 0 ? (
              <div className="rounded-[22px] p-8 text-center" style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <ActiveIcon className="w-7 h-7" style={{ color: '#334155' }} />
                </div>
                <p className="text-sm font-bold" style={{ color: '#64748b' }}>No {activeTab.toLowerCase()} items</p>
                <p className="text-xs mt-1" style={{ color: '#475569' }}>Win drops or visit the shop to expand this slot.</p>
              </div>
            ) : (
              sortedTabItems.map((item) => {
                const theme = getTierTheme(item);
                const tierLabel = getTierLabel(item);
                const slot = getSlotKey(item);
                const classKey = getClassKey(item);
                const classTheme = CLASS_THEME[classKey] || { bg: 'rgba(255,255,255,0.06)', color: '#94a3b8' };
                const passiveText = getPassiveText(item);
                const baseRows = getItemStatRows(item, { source: 'base_stats' });
                const enchantRows = getItemStatRows(item, { source: 'enchant_stats' });
                const effectiveRows = getItemStatRows(item, { source: 'effective_stats' });
                const isEquipped = equippedInventoryIds.has(item.inventory_id) || Boolean(item.equipped);
                const isEquipping = equipping === item.inventory_id;
                const wrongClass = Boolean(userClass && classKey && userClass !== classKey);
                const duplicateMeta = duplicateIndexByInventoryId.get(item.inventory_id);

                return (
                  <div
                    key={item.inventory_id}
                    className="rounded-[22px] p-4"
                    style={{
                      background: isEquipped
                        ? `linear-gradient(135deg, rgba(15,23,42,0.95) 0%, ${theme.soft} 100%)`
                        : tierLabel === 'Legendary'
                          ? 'linear-gradient(135deg, rgba(42,30,8,0.92) 0%, rgba(26,26,46,0.92) 100%)'
                          : tierLabel === 'Epic'
                            ? 'linear-gradient(135deg, rgba(36,16,52,0.92) 0%, rgba(26,26,46,0.92) 100%)'
                            : 'rgba(26,26,46,0.84)',
                      border: `1px solid ${isEquipped ? 'rgba(201,168,76,0.4)' : theme.border}`,
                      boxShadow: isEquipped ? '0 0 18px rgba(201,168,76,0.16)' : `0 0 16px ${theme.glow}`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <ItemImage item={item} size={56} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3
                                className="font-extrabold"
                                style={{
                                  color: '#e8e0d0',
                                  fontSize: 15,
                                  margin: 0,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {item.name}
                              </h3>
                              {isEquipped ? (
                                <MetaChip style={{ background: 'rgba(201,168,76,0.2)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.24)' }}>
                                  Equipped
                                </MetaChip>
                              ) : null}
                            </div>
                          </div>

                          {duplicateMeta?.total > 1 ? (
                            <MetaChip style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              Copy {duplicateMeta.index}/{duplicateMeta.total}
                            </MetaChip>
                          ) : null}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                          <MetaChip style={{ color: theme.color, background: theme.soft, border: `1px solid ${theme.border}` }}>
                            {tierLabel}
                          </MetaChip>
                          {slot ? (
                            <MetaChip style={{ color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              {formatSlotLabel(slot)}
                            </MetaChip>
                          ) : null}
                          {classKey ? (
                            <MetaChip style={{ color: classTheme.color, background: classTheme.bg, border: '1px solid transparent' }}>
                              {formatClassLabel(classKey)}
                            </MetaChip>
                          ) : null}
                          <EnchantBadge item={item} />
                          {item.source ? (
                            <MetaChip style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                              {item.source}
                            </MetaChip>
                          ) : null}
                        </div>

                        <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
                          <StatGroup title="Base" rows={baseRows} color={theme.color} emptyText="No base stats" />
                          {enchantRows.length ? (
                            <StatGroup title="Enchant bonus" rows={enchantRows} color="#c9a84c" />
                          ) : null}
                          {effectiveRows.length ? (
                            <StatGroup title="Total" rows={effectiveRows} color="#e8e0d0" />
                          ) : null}
                        </div>

                        {passiveText ? (
                          <div
                            style={{
                              marginTop: 10,
                              borderRadius: 12,
                              padding: '8px 10px',
                              background: tierLabel === 'Legendary'
                                ? 'rgba(201,168,76,0.14)'
                                : tierLabel === 'Epic'
                                  ? 'rgba(168,85,247,0.12)'
                                  : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${theme.border}`,
                            }}
                          >
                            <p style={{ color: theme.color, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                              Passive
                            </p>
                            <p style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600, margin: '3px 0 0' }}>
                              {passiveText}
                            </p>
                          </div>
                        ) : null}

                        {item.description ? (
                          <p style={{ color: '#64748b', fontSize: 11, margin: '10px 0 0', fontWeight: 500 }}>
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>
                        {item.inventory_id ? `Owned copy ID: ${String(item.inventory_id).slice(0, 8)}` : 'Owned copy'}
                      </div>

                      {isEquipped ? null : wrongClass ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textAlign: 'right' }}>
                          Switch to {formatClassLabel(classKey)} to equip
                        </span>
                      ) : (
                        <Button
                          onClick={() => handleEquip(item)}
                          disabled={isEquipping}
                          style={{
                            flexShrink: 0,
                            height: 36,
                            padding: '0 14px',
                            borderRadius: 12,
                            fontWeight: 800,
                            fontSize: 12,
                            background: isEquipping ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#8b0000,#c0392b)',
                            color: isEquipping ? '#475569' : 'white',
                            border: '1px solid rgba(201,168,76,0.25)',
                            cursor: isEquipping ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isEquipping ? '...' : 'Equip copy'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </>
      ) : null}

      {hubTab === 'upgrade' ? (
        <>
          <section className="rounded-[24px] p-4" style={{ background: 'rgba(13,13,26,0.96)', border: '1px solid rgba(201,168,76,0.18)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide" style={{ color: '#c9a84c' }}>Upgrade</p>
                <h3 className="text-xl font-extrabold mt-1" style={{ color: '#e8e0d0' }}>Enchant Gear</h3>
                <p className="text-xs font-medium mt-1" style={{ color: '#64748b' }}>
                  Weapon and armor copies only. Backend decides success, failure, and destruction.
                </p>
              </div>
              <MetaChip style={{ color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.22)' }}>
                {upgradeItems.length} items
              </MetaChip>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            {SCROLL_OPTIONS.map((scroll) => {
              const selected = selectedScroll === scroll.key;
              const count = Number(scrolls[scroll.key] || 0);
              const shopItem = scrollShop.find((shopScroll) => shopScroll.scroll_type === scroll.key);
              return (
                <button
                  key={scroll.key}
                  type="button"
                  onClick={() => setSelectedScroll(scroll.key)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 18,
                    padding: 12,
                    border: selected ? '1px solid rgba(201,168,76,0.5)' : '1px solid rgba(255,255,255,0.08)',
                    background: selected ? 'linear-gradient(135deg, rgba(42,30,8,0.9), rgba(26,26,46,0.9))' : 'rgba(26,26,46,0.75)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                    <ScrollImage scroll={scroll} selected={selected} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ color: selected ? '#c9a84c' : '#e8e0d0', fontSize: 13, fontWeight: 900, margin: 0 }}>{scroll.label}</p>
                      <p style={{ color: '#64748b', fontSize: 11, fontWeight: 700, margin: '4px 0 0' }}>
                        Owned: {count}{shopItem ? ` | ${Number(shopItem.price || 0).toLocaleString()} coins` : ''}
                      </p>
                    </div>
                  </div>
                  <p style={{ color: '#94a3b8', fontSize: 11, margin: '8px 0 0' }}>{scroll.note}</p>
                </button>
              );
            })}
          </section>

          {enchantResult ? (
            <section
              className="rounded-[22px] p-4"
              style={{
                background: enchantResult.destroyed
                  ? 'rgba(127,29,29,0.18)'
                  : enchantResult.success
                    ? 'rgba(34,197,94,0.12)'
                    : 'rgba(201,168,76,0.1)',
                border: enchantResult.destroyed
                  ? '1px solid rgba(248,113,113,0.26)'
                  : enchantResult.success
                    ? '1px solid rgba(34,197,94,0.25)'
                    : '1px solid rgba(201,168,76,0.22)',
              }}
            >
              <p style={{ color: enchantResult.destroyed ? '#f87171' : enchantResult.success ? '#22c55e' : '#c9a84c', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                {enchantResult.destroyed ? 'Destroyed' : enchantResult.success ? 'Success' : 'Failed'}
              </p>
              <p style={{ color: '#e8e0d0', fontSize: 13, fontWeight: 700, margin: '6px 0 0' }}>
                {enchantResult.item_name}: +{enchantResult.previous_enchant_level} to +{enchantResult.new_enchant_level}
              </p>
              <p style={{ color: '#64748b', fontSize: 11, margin: '4px 0 0' }}>
                Chance {chancePercent(enchantResult.success_chance)}. Roll {Number(enchantResult.roll || 0).toFixed(3)}. Remaining {enchantResult.scroll_type}: {enchantResult.remaining_scrolls}.
              </p>
            </section>
          ) : null}

          <section className="grid gap-3">
            {upgradeItems.length === 0 ? (
              <div className="rounded-[22px] p-8 text-center" style={{ background: 'rgba(26,26,46,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <Gem className="w-8 h-8 mx-auto mb-3" style={{ color: '#334155' }} />
                <p className="text-sm font-bold" style={{ color: '#64748b' }}>No enchantable gear</p>
                <p className="text-xs mt-1" style={{ color: '#475569' }}>Weapon and armor copies appear here.</p>
              </div>
            ) : (
              upgradeItems.map((item) => (
                <UpgradeItemRow
                  key={item.inventory_id}
                  item={item}
                  selected={item.inventory_id === selectedUpgradeId}
                  onSelect={setSelectedUpgradeId}
                />
              ))
            )}
          </section>

          {selectedUpgradeItem ? (
            <section className="rounded-[24px] p-4" style={{ background: 'rgba(13,13,26,0.96)', border: `1px solid ${getTierTheme(selectedUpgradeItem).border}`, boxShadow: `0 0 20px ${getTierTheme(selectedUpgradeItem).glow}` }}>
              <div className="flex items-start gap-3">
                <ItemImage item={selectedUpgradeItem} size={64} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p style={{ color: '#e8e0d0', fontSize: 16, fontWeight: 900, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedUpgradeItem.name}
                      </p>
                      <p style={{ color: '#c9a84c', fontSize: 20, fontWeight: 900, margin: '2px 0 0' }}>
                        +{selectedLevel}
                      </p>
                    </div>
                    <MetaChip style={{ color: getTierTheme(selectedUpgradeItem).color, background: getTierTheme(selectedUpgradeItem).soft, border: `1px solid ${getTierTheme(selectedUpgradeItem).border}` }}>
                      {getTierLabel(selectedUpgradeItem)}
                    </MetaChip>
                  </div>

                </div>
              </div>

              <div className="grid gap-2 mt-4">
                <StatGroup
                  title={`Current +${selectedPreview?.current_enchant_level ?? selectedLevel}`}
                  rows={getStatEntries(selectedPreview?.current_stats || selectedUpgradeItem.effective_stats)}
                  color={getTierTheme(selectedUpgradeItem).color}
                  emptyText="No current stat contribution"
                  limit={6}
                />
                <StatGroup
                  title={`Next +${selectedPreview?.next_enchant_level ?? Math.min(selectedLevel + 1, selectedMax || selectedLevel + 1)} enchant`}
                  rows={getStatEntries(selectedPreview?.next_enchant_stats)}
                  color="#c9a84c"
                  emptyText={isAtMax ? 'Already at max enchant' : 'No next enchant bonus'}
                  limit={6}
                />
                <StatGroup
                  title="After upgrade"
                  rows={getStatEntries(selectedPreview?.next_effective_stats)}
                  color="#e8e0d0"
                  limit={6}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 mt-4">
                <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <p style={{ color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>Outcome</p>
                  <p style={{ color: hasGuaranteedSuccess ? '#22c55e' : normalDestroyRisk ? '#f87171' : '#f59e0b', fontSize: 13, fontWeight: 900, margin: '4px 0 0' }}>
                    {hasGuaranteedSuccess ? 'Guaranteed success' : normalDestroyRisk ? 'Destruction risk' : 'Failure keeps copy'}
                  </p>
                </div>
                <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <p style={{ color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>Chance</p>
                  <p style={{ color: '#e8e0d0', fontSize: 13, fontWeight: 900, margin: '4px 0 0' }}>
                    {chancePercent(selectedChance)}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl p-3 mt-3" style={{ background: normalDestroyRisk ? 'rgba(127,29,29,0.18)' : 'rgba(255,255,255,0.04)', border: normalDestroyRisk ? '1px solid rgba(248,113,113,0.25)' : '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-start gap-2">
                  {normalDestroyRisk ? <AlertTriangle className="w-4 h-4 mt-0.5" style={{ color: '#f87171', flexShrink: 0 }} /> : <Sparkles className="w-4 h-4 mt-0.5" style={{ color: '#c9a84c', flexShrink: 0 }} />}
                  <div>
                    <p style={{ color: normalDestroyRisk ? '#f87171' : '#c9a84c', fontSize: 12, fontWeight: 900, margin: 0 }}>
                      {normalDestroyRisk ? 'Destruction risk active' : hasGuaranteedSuccess ? 'Guaranteed success chance' : 'Item is protected by blessed scroll'}
                    </p>
                    <p style={{ color: '#94a3b8', fontSize: 11, margin: '4px 0 0' }}>
                      {normalDestroyRisk
                        ? 'Normal scroll failure can destroy this exact owned copy.'
                        : selectedScroll === 'blessed_scroll'
                          ? 'Blessed scroll failure does not destroy the item.'
                          : 'This attempt is guaranteed by the current server success chance.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mt-4">
                <div>
                  <p style={{ color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>
                    Selected scroll
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                    <ScrollImage scroll={SCROLL_OPTIONS.find((scroll) => scroll.key === selectedScroll) || SCROLL_OPTIONS[0]} selected />
                    <p style={{ color: '#e8e0d0', fontSize: 13, fontWeight: 800, margin: 0 }}>
                      {SCROLL_OPTIONS.find((scroll) => scroll.key === selectedScroll)?.shortLabel} x{selectedScrollCount}
                      {selectedScrollShopItem ? ` | ${Number(selectedScrollShopItem.price || 0).toLocaleString()} coins` : ''}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleEnchant}
                  disabled={!selectedUpgradeItem || isAtMax || selectedScrollCount <= 0 || enchanting}
                  style={{
                    height: 42,
                    padding: '0 18px',
                    borderRadius: 14,
                    fontWeight: 900,
                    background: !selectedUpgradeItem || isAtMax || selectedScrollCount <= 0 || enchanting
                      ? 'rgba(255,255,255,0.05)'
                      : normalDestroyRisk
                        ? 'linear-gradient(135deg,#7f1d1d,#c0392b)'
                        : 'linear-gradient(135deg,#8b6914,#c9a84c)',
                    color: !selectedUpgradeItem || isAtMax || selectedScrollCount <= 0 || enchanting ? '#475569' : normalDestroyRisk ? 'white' : '#0a0a0a',
                    border: normalDestroyRisk ? '1px solid rgba(248,113,113,0.25)' : '1px solid rgba(201,168,76,0.35)',
                    cursor: !selectedUpgradeItem || isAtMax || selectedScrollCount <= 0 || enchanting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {enchanting ? 'Enchanting...' : isAtMax ? 'Maxed' : 'Enchant'}
                </Button>
              </div>

              {selectedScrollCount <= 0 && selectedScrollShopItem ? (
                <button
                  type="button"
                  onClick={() => handleBuyScroll(selectedScrollShopItem)}
                  disabled={buyingScroll === selectedScrollShopItem.scroll_type}
                  style={{
                    width: '100%',
                    marginTop: 10,
                    borderRadius: 14,
                    padding: '10px 12px',
                    background: 'rgba(201,168,76,0.1)',
                    border: '1px solid rgba(201,168,76,0.22)',
                    color: '#c9a84c',
                    fontWeight: 900,
                    fontSize: 12,
                    cursor: buyingScroll === selectedScrollShopItem.scroll_type ? 'not-allowed' : 'pointer',
                  }}
                >
                  {buyingScroll === selectedScrollShopItem.scroll_type ? 'Buying...' : `Buy ${selectedScrollShopItem.name || 'scroll'} for ${Number(selectedScrollShopItem.price || 0).toLocaleString()} coins`}
                </button>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
