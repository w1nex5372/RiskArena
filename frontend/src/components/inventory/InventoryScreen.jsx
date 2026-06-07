import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Backpack, BatteryCharging, Check, Gem, HardHat, Shield, ShoppingBag, Sparkles, Sword } from 'lucide-react';
import ItemDetailModal from './ItemDetailModal';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import ShopScreen from '../shop/ShopScreen';
import apiClient from '../../api/client';
import { CLASS_INFO, CLASS_MODIFIERS } from '../../utils/characters';
import CharacterPortrait from '../arena/CharacterPortrait';
import BattleSkillLoadout from '../arena/BattleSkillLoadout';
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
import WeaponIcon from '../WeaponIcon';
import ArmorIcon from '../ArmorIcon';

const HUB_TABS = [
  { key: 'loadout', label: 'Inventory', helper: 'Your collected gear', cta: 'Manage', Icon: Backpack },
  { key: 'shop', label: 'Shop', helper: 'Browse all class gear', cta: 'Browse', Icon: ShoppingBag },
  { key: 'upgrade', label: 'Upgrade', helper: 'Enchant owned copies', cta: 'Enchant', Icon: Gem },
];

const TABS = ['Weapon', 'Armor', 'Helmet', 'Ability', 'Consumables'];

const TAB_CATEGORY = {
  Weapon: 'weapon',
  Armor: 'armor',
  Helmet: 'helmet',
  Ability: 'ability',
  Consumables: 'consumable',
};

const TAB_ICON = {
  Weapon: Sword,
  Armor: Shield,
  Helmet: HardHat,
  Ability: Sparkles,
  Consumables: BatteryCharging,
};

const LOADOUT_SLOTS = [
  { key: 'weapon', label: 'Weapon', Icon: Sword },
  { key: 'helmet', label: 'Helmet', Icon: HardHat },
  { key: 'armor', label: 'Armor', Icon: Shield },
  { key: 'ability', label: 'Item Skill', Icon: Sparkles },
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

function GridItemImage({ src, item, FallbackIcon, theme, ringClass, size = 48 }) {
  const [failed, setFailed] = useState(false);
  const imagePath = item?.image_path;
  const slot = getSlotKey(item);
  if (slot === 'weapon' && imagePath && !failed) {
    return <WeaponIcon imagePath={imagePath} size={size} borderRadius={8} enchantLevel={item?.enchant_level || 0} />;
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
      className={ringClass}
      style={{ width: '78%', height: '78%', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: 8 }}
      onError={() => setFailed(true)}
    />
  );
}

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

function ItemImage({ item, size = 52 }) {
  const [failed, setFailed] = useState(false);
  const theme = getTierTheme(item);
  const src = getItemImageSrc(item);
  const slot = getSlotKey(item);
  const Icon = TAB_ICON[formatSlotLabel(slot)] || Sword;
  const ringClass = rarityRingClass(item);
  const imagePath = item?.image_path;

  useEffect(() => { setFailed(false); }, [src]);

  if (slot === 'weapon' && imagePath && !failed) {
    return (
      <div className={ringClass} style={{ flexShrink: 0, border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <WeaponIcon imagePath={imagePath} size={size} borderRadius={0} enchantLevel={item?.enchant_level || 0} />
      </div>
    );
  }

  if ((slot === 'armor' || slot === 'helmet') && imagePath && !failed) {
    return (
      <div className={ringClass} style={{ flexShrink: 0, border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <ArmorIcon imagePath={imagePath} size={size} borderRadius={0} />
      </div>
    );
  }

  if (!src || failed) {
    return (
      <div
        className={ringClass}
        style={{
          width: size, height: size, borderRadius: 14, flexShrink: 0,
          background: `linear-gradient(135deg, ${theme.soft}, rgba(255,255,255,0.02))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
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
      className={ringClass}
      style={{
        width: size, height: size, borderRadius: 14,
        objectFit: 'cover', flexShrink: 0,
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
  if (level <= 0) return null;
  return (
    <MetaChip style={{ color: '#c9a84c', background: 'rgba(201,168,76,0.14)', border: '1px solid rgba(201,168,76,0.24)' }}>
      +{level}
    </MetaChip>
  );
}

function LoadoutCard({ slot, item, onTabJump }) {
  const theme = item ? getTierTheme(item) : null;
  const passiveText = getPassiveText(item);
  const statChips = item ? getItemStatRows(item).slice(0, 4) : [];
  const enchantRows = item ? getItemStatRows(item, { source: 'enchant_stats' }) : [];

  if (!item) {
    return (
      <button
        type="button"
        onClick={() => onTabJump(slot.label)}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          borderRadius: 14, padding: '12px 14px',
          border: '1px dashed rgba(148,163,184,0.18)',
          background: 'rgba(255,255,255,0.02)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}
      >
        <div style={{
          width: 48, height: 48, borderRadius: 12, flexShrink: 0,
          border: '1px dashed rgba(148,163,184,0.18)',
          background: 'rgba(255,255,255,0.02)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <slot.Icon style={{ width: 20, height: 20, color: '#334155' }} />
        </div>
        <div>
          <p style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569', margin: 0 }}>
            {slot.label}
          </p>
          <p style={{ color: '#64748b', fontWeight: 700, fontSize: 13, margin: '3px 0 0' }}>
            Empty — tap to equip
          </p>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onTabJump(slot.label)}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        borderRadius: 14, overflow: 'hidden', padding: 0,
        border: `1px solid ${theme.border}`,
        background: `linear-gradient(135deg, rgba(8,12,24,0.97) 0%, ${theme.soft} 100%)`,
        boxShadow: `0 4px 20px ${theme.glow}`,
      }}
    >
      <div style={{ height: 2, background: `linear-gradient(90deg, ${theme.color}, transparent)` }} />
      <div style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <ItemImage item={item} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: theme.color, margin: 0 }}>
            {slot.label}
          </p>
          <p style={{ color: '#f1f5f9', fontWeight: 900, fontSize: 15, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            <MetaChip style={{ color: theme.color, background: theme.soft, border: `1px solid ${theme.border}` }}>
              {getTierLabel(item)}
            </MetaChip>
            <MetaChip style={{ color: '#94a3b8', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {formatClassLabel(getClassKey(item))}
            </MetaChip>
            <EnchantBadge item={item} />
          </div>
          {statChips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
              {statChips.map((chip) => (
                <span key={chip.key} style={{
                  fontSize: 11, fontWeight: 800, color: theme.color,
                  background: theme.soft, border: `1px solid ${theme.border}`,
                  borderRadius: 999, padding: '3px 8px',
                }}>
                  {chip.label}
                </span>
              ))}
            </div>
          )}
          {enchantRows.length > 0 && (
            <p style={{ color: '#c9a84c', fontSize: 10, fontWeight: 800, margin: '6px 0 0' }}>
              ✦ Enchant: {enchantRows.map((r) => r.label).join(', ')}
            </p>
          )}
          {passiveText && (
            <p style={{ color: theme.color, fontSize: 10, fontWeight: 800, margin: '5px 0 0' }}>
              ✦ {passiveText}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function mergeStatTotals(...statSources) {
  return statSources.reduce((totals, stats) => {
    Object.entries(stats || {}).forEach(([key, value]) => {
      totals[key] = (totals[key] || 0) + Number(value || 0);
    });
    return totals;
  }, {});
}

function ClassHeroCard({ user, loadoutEffectiveStats, loadoutPowerSummary, equippedBySlot }) {
  const activeKey = String(user?.class_name || 'warrior').trim().toLowerCase();
  const info = CLASS_INFO[activeKey] || CLASS_INFO.warrior;
  const classBonusSummary = getStatEntries(CLASS_MODIFIERS[activeKey] || {});
  const viewedKey = activeKey;
  const isActive = true;
  const saving = false;
  const prev = () => {};
  const next = () => {};
  const select = () => {};
  const navBtnStyle = { display: 'none' };

  return (
    <div style={{
      borderRadius: 20,
      overflow: 'hidden',
      border: `1px solid ${info.color}55`,
      background: 'linear-gradient(160deg, rgba(8,12,24,0.99) 0%, rgba(18,18,36,0.99) 100%)',
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${info.color}, transparent)` }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 0' }}>
        <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c9a84c', margin: 0 }}>
          Your Class
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" onClick={prev} style={navBtnStyle}>‹</button>
          <span style={{ fontSize: 11, fontWeight: 800, color: info.color, minWidth: 54, textAlign: 'center' }}>
            {info.name}
          </span>
          <button type="button" onClick={next} style={navBtnStyle}>›</button>
        </div>
      </div>

      {/* Hero body */}
      <div style={{ display: 'flex', gap: 14, padding: '14px 14px 0', alignItems: 'flex-start' }}>
        {/* Character image */}
        <div style={{ flexShrink: 0 }}>
          <CharacterPortrait
            cls={viewedKey}
            size={104}
            active={isActive}
            sheetPath={isActive ? (user?.battle_spritesheet_path || user?.character_spritesheet_path) : null}
            sheetLoading={isActive && user && !user.battle_spritesheet_path && !user.character_spritesheet_path}
            armor={equippedBySlot?.armor || null}
            helmet={equippedBySlot?.helmet || null}
            showWeaponBadge={false}
            showArmorBadge={false}
            showHelmetBadge={false}
            style={{
              borderRadius: 14,
              border: `1px solid ${info.color}33`,
              boxShadow: `0 0 18px ${info.glow}`,
              transition: 'opacity 0.2s ease',
            }}
          />
        </div>

        {/* Class info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 21, fontWeight: 900, color: info.color, lineHeight: 1 }}>
              {info.icon} {info.name}
            </span>
            {isActive && (
              <span style={{
                fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em',
                color: '#22c55e', background: 'rgba(34,197,94,0.12)',
                border: '1px solid rgba(34,197,94,0.28)', borderRadius: 999, padding: '3px 7px',
                whiteSpace: 'nowrap',
              }}>
                ACTIVE ✓
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', marginTop: 3 }}>
            {info.title}
          </div>

          {/* Class bonuses */}
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 9, color: '#64748b', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 5px' }}>
              Class Bonuses
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(classBonusSummary.length ? classBonusSummary : info.bonuses.map((label, index) => ({ key: `fallback-${index}`, label }))).map((row) => (
                <span key={row.key} style={{
                  fontSize: 10, fontWeight: 700, color: info.color,
                  background: `${info.color}18`, border: `1px solid ${info.color}40`,
                  borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap',
                }}>
                  {row.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 14px 14px' }}>
        {!isActive ? (
          <>
            {!activeKey && (
              <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginBottom: 8, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.25)' }}>
                Choose a class to enter the Arena
              </div>
            )}
            <button
              type="button"
              onClick={select}
              disabled={saving}
              style={{
                width: '100%', height: 42, borderRadius: 12, fontWeight: 800, fontSize: 13,
                cursor: saving ? 'not-allowed' : 'pointer',
                background: `linear-gradient(135deg, ${info.color}cc, ${info.color}66)`,
                color: '#fff', border: `1px solid ${info.color}55`,
                opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s',
              }}
            >
              {saving ? 'Switching...' : `Select ${info.name}`}
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 11, color: '#475569', padding: '2px 0' }}>
            {loadoutPowerSummary.length === 0
              ? 'Equip items to see your loadout stats'
              : `${loadoutPowerSummary.length} stat${loadoutPowerSummary.length !== 1 ? 's' : ''} from equipped gear`}
          </div>
        )}
      </div>
    </div>
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

export default function InventoryScreen({ user, onClassChange, onUserUpdate }) {
  const [hubTab, setHubTab] = useState('loadout');
  const [activeTab, setActiveTab] = useState('Weapon');
  const inventoryListRef = useRef(null);
  const [displayBalance, setDisplayBalance] = useState(user?.token_balance || 0);
  const [inventory, setInventory] = useState(null);
  const [equippedInventoryIds, setEquippedInventoryIds] = useState(new Set());
  const [equippedBySlot, setEquippedBySlot] = useState({ weapon: null, armor: null, ability: null, helmet: null });
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
  const [unequipping, setUnequipping] = useState(null);
  const [selling, setSelling] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filterSlot, setFilterSlot] = useState('all');
  const latestUserRef = useRef(user);
  const onUserUpdateRef = useRef(onUserUpdate);
  const previousClassRef = useRef(user?.class_name || null);

  useEffect(() => {
    latestUserRef.current = user;
  }, [user]);

  useEffect(() => {
    onUserUpdateRef.current = onUserUpdate;
  }, [onUserUpdate]);

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
      helmet: equipped.helmet || null,
    });
    setLoadoutEffectiveStats(data?.loadout_effective_stats || {});
    const nextBattleSheetPath = data?.battle_spritesheet_path || '';
    const nextBattleSheetHash = data?.battle_spritesheet_hash || '';
    const currentUser = latestUserRef.current || {};
    if (
      (nextBattleSheetPath || nextBattleSheetHash) &&
      (
        nextBattleSheetPath !== (currentUser.battle_spritesheet_path || '') ||
        nextBattleSheetHash !== (currentUser.battle_spritesheet_hash || '')
      )
    ) {
      onUserUpdateRef.current?.({
        battle_spritesheet_path: nextBattleSheetPath,
        battle_spritesheet_hash: nextBattleSheetHash,
      });
    }
  }, []);

  const refreshItems = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setInventory(null);
      setLoadError(false);
    }

    const inventoryRequest = apiClient.get('/inventory');
    const equippedRequest = apiClient.get('/me/equipped').catch(() => ({ data: {} }));
    const upgradeRequest = apiClient.get('/me/upgrade').catch(() => ({ data: { items: [], scrolls: {} } }));
    const scrollShopRequest = apiClient.get('/shop/scrolls').catch(() => ({ data: { scrolls: [] } }));

    const [inventoryResponse, equippedResponse] = await Promise.all([
      inventoryRequest,
      equippedRequest,
    ]);

    const items = Array.isArray(inventoryResponse.data) ? inventoryResponse.data : inventoryResponse.data?.items ?? [];

    setInventory(items);
    applyEquippedState(equippedResponse.data);

    const [upgradeResponse, scrollShopResponse] = await Promise.all([
      upgradeRequest,
      scrollShopRequest,
    ]);
    const nextUpgradeItems = upgradeResponse.data?.items || [];

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

  useEffect(() => {
    const currentClass = user?.class_name || null;
    if (!currentClass || previousClassRef.current === currentClass) return;
    previousClassRef.current = currentClass;
    refreshItems().catch(() => {});
  }, [refreshItems, user?.class_name]);

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

  const handleUnequip = async (item) => {
    const slot = getSlotKey(item);
    if (unequipping || !slot) return;
    setUnequipping(item.inventory_id);
    try {
      await apiClient.post('/me/unequip', { slot });
      toast.success(`${item.name} unequipped`);
      await refreshItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to unequip item');
    } finally {
      setUnequipping(null);
    }
  };

  const handleSell = async (item) => {
    if (selling) return;
    setSelling(String(item.inventory_id));
    try {
      const res = await apiClient.post('/me/sell', { inventory_id: item.inventory_id });
      const newBalance = res.data?.new_balance;
      if (newBalance != null) {
        setDisplayBalance(newBalance);
        onUserUpdate?.({ token_balance: newBalance });
      }
      toast.success(`Sold ${item.name} for ${res.data.sell_price} coins`);
      setSelectedItem(null);
      await refreshItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to sell item');
    } finally {
      setSelling(null);
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

  const TIER_SCORE = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };

  const allItemsSorted = useMemo(() => {
    return [...(inventory || [])].sort((a, b) => {
      const aEquipped = equippedInventoryIds.has(a.inventory_id) || Boolean(a.equipped) ? 1 : 0;
      const bEquipped = equippedInventoryIds.has(b.inventory_id) || Boolean(b.equipped) ? 1 : 0;
      if (bEquipped !== aEquipped) return bEquipped - aEquipped;
      const tierDelta = (TIER_SCORE[getTierKey(b)] || 0) - (TIER_SCORE[getTierKey(a)] || 0);
      if (tierDelta !== 0) return tierDelta;
      return Number(b.enchant_level || 0) - Number(a.enchant_level || 0);
    });
  }, [inventory, equippedInventoryIds]);

  const displayedItems = filterSlot === 'all'
    ? allItemsSorted
    : allItemsSorted.filter((item) => getSlotKey(item) === filterSlot);

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
        <div style={{ display: 'flex', gap: 4 }}>
          {HUB_TABS.map(({ key, label, Icon }) => {
            const active = hubTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setHubTab(key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '10px 6px',
                  borderRadius: 12,
                  border: active ? '1px solid rgba(201,168,76,0.45)' : '1px solid rgba(255,255,255,0.07)',
                  background: active
                    ? 'linear-gradient(135deg, rgba(139,0,0,0.7) 0%, rgba(192,57,43,0.7) 100%)'
                    : 'rgba(255,255,255,0.035)',
                  color: active ? 'white' : '#64748b',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                  boxShadow: active ? '0 4px 14px rgba(139,0,0,0.3)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon style={{ width: 16, height: 16, color: active ? '#c9a84c' : '#475569' }} />
                <span>{label}</span>
              </button>
            );
          })}
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
          <ClassHeroCard
            user={user}
            loadoutEffectiveStats={loadoutEffectiveStats}
            loadoutPowerSummary={loadoutPowerSummary}
            equippedBySlot={equippedBySlot}
            onClassChange={onClassChange}
          />

          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#c9a84c', margin: '0 0 8px' }}>
              BATTLE SKILLS
            </p>
            <BattleSkillLoadout
              className={user?.class_name}
              equippedAbility={equippedBySlot.ability}
              onItemClick={() => {
                if (equippedBySlot.ability) setSelectedItem(equippedBySlot.ability);
                else jumpToInventorySlot('Ability');
              }}
            />
          </div>

          <div style={{ marginTop: 16 }} ref={inventoryListRef}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <p style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#c9a84c', margin: 0 }}>
                INVENTORY
              </p>
              {inventory !== null && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: '#94a3b8',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 999,
                  padding: '2px 7px',
                }}>
                  {filterSlot === 'all' ? allItemsSorted.length : `${displayedItems.length}/${allItemsSorted.length}`}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
              {[
                { key: 'all', label: 'All' },
                { key: 'weapon', label: '⚔️' },
                { key: 'helmet', label: '🪖' },
                { key: 'armor', label: '🛡️' },
                { key: 'ability', label: '✨' },
              ].map(({ key, label }) => {
                const active = filterSlot === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilterSlot(key)}
                    style={{
                      flex: 1,
                      padding: '6px 4px',
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      border: active ? '1px solid rgba(201,168,76,0.45)' : '1px solid rgba(255,255,255,0.07)',
                      background: active ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.03)',
                      color: active ? '#c9a84c' : '#64748b',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {inventory === null ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
                  <div
                    key={index}
                    style={{
                      aspectRatio: '1 / 1',
                      borderRadius: 12,
                      background: 'rgba(26,26,46,0.6)',
                      border: '1px solid rgba(201,168,76,0.1)',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}
                  />
                ))}
              </div>
            ) : displayedItems.length === 0 ? (
              <div style={{
                borderRadius: 22,
                padding: '32px 16px',
                textAlign: 'center',
                background: 'rgba(26,26,46,0.7)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <p style={{ color: '#64748b', fontSize: 13, fontWeight: 700, margin: 0 }}>No items yet</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}>
                {displayedItems.map((item) => {
                  const theme = getTierTheme(item);
                  const isEquipped = equippedInventoryIds.has(item.inventory_id) || Boolean(item.equipped);
                  const enchantLevel = Number(item.enchant_level || 0);
                  const slot = getSlotKey(item);
                  const FallbackIcon = TAB_ICON[formatSlotLabel(slot)] || Sword;
                  const src = getItemImageSrc(item);
                  const duplicateInfo = duplicateIndexByInventoryId.get(item.inventory_id);
                  return (
                    <button
                      type="button"
                      key={item.inventory_id}
                      onClick={() => setSelectedItem(item)}
                      title={item.name}
                      aria-label={`${item.name}${isEquipped ? ', equipped' : ''}`}
                      style={{
                        position: 'relative',
                        aspectRatio: '1 / 1',
                        borderRadius: 12,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        padding: 5,
                        background: `linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(10,14,28,0.98) 100%)`,
                        border: isEquipped ? '1.5px solid rgba(201,168,76,0.76)' : `1px solid ${theme.border}`,
                        boxShadow: isEquipped ? '0 0 18px rgba(201,168,76,0.28)' : `0 0 12px ${theme.glow}`,
                        color: 'inherit',
                        appearance: 'none',
                      }}
                    >
                      <div style={{
                        width: '100%',
                        height: '100%',
                        position: 'relative',
                        borderRadius: 10,
                        border: `1px solid ${theme.border}`,
                        background: `radial-gradient(circle at 50% 30%, ${theme.soft} 0%, rgba(8,12,24,0.95) 62%)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}>
                        <GridItemImage src={src} item={item} FallbackIcon={FallbackIcon} theme={theme} ringClass={rarityRingClass(item)} size={46} />
                        <div style={{
                          position: 'absolute',
                          left: 5,
                          top: 5,
                          width: 8,
                          height: 8,
                          color: theme.color,
                          background: theme.color,
                          border: '1px solid rgba(0,0,0,0.45)',
                          borderRadius: 999,
                          boxShadow: `0 0 8px ${theme.glow}`,
                        }}>
                        </div>
                        {isEquipped && (
                          <div style={{
                            position: 'absolute',
                            bottom: 5,
                            left: 5,
                            width: 18,
                            height: 18,
                            fontWeight: 900,
                            color: '#c9a84c',
                            background: 'rgba(0,0,0,0.58)',
                            border: '1px solid rgba(201,168,76,0.32)',
                            borderRadius: 999,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <Check style={{ width: 11, height: 11 }} />
                          </div>
                        )}
                        {enchantLevel > 0 && (
                          <div style={{
                            position: 'absolute',
                            top: 5,
                            right: 5,
                            fontSize: 10,
                            fontWeight: 900,
                            color: '#c9a84c',
                            background: 'rgba(0,0,0,0.62)',
                            border: '1px solid rgba(201,168,76,0.28)',
                            borderRadius: 999,
                            padding: '2px 6px',
                            lineHeight: 1,
                          }}>
                            +{enchantLevel}
                          </div>
                        )}
                        <div style={{
                          position: 'absolute',
                          right: 5,
                          bottom: 5,
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          background: 'rgba(0,0,0,0.46)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <FallbackIcon style={{ width: 10, height: 10, color: '#94a3b8' }} />
                        </div>
                        {duplicateInfo?.total > 1 && (
                          <div style={{
                            position: 'absolute',
                            left: '50%',
                            bottom: 5,
                            transform: 'translateX(-50%)',
                            fontSize: 9,
                            fontWeight: 900,
                            color: '#cbd5e1',
                            background: 'rgba(0,0,0,0.58)',
                            border: '1px solid rgba(255,255,255,0.10)',
                            borderRadius: 999,
                            padding: '2px 5px',
                            lineHeight: 1,
                          }}>
                            {duplicateInfo.index}/{duplicateInfo.total}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>


          {selectedItem && (
            <ItemDetailModal
              item={selectedItem}
              userClass={userClass}
              equippedInventoryIds={equippedInventoryIds}
              equippedBySlot={equippedBySlot}
              equipping={equipping}
              unequipping={unequipping}
              onEquip={async (item) => { await handleEquip(item); setSelectedItem(null); }}
              onUnequip={async (item) => { await handleUnequip(item); setSelectedItem(null); }}
              onClose={() => setSelectedItem(null)}
              onGoToUpgrade={() => { setSelectedItem(null); setHubTab('upgrade'); }}
              selling={selling}
              onSell={async (item) => { await handleSell(item); }}
            />
          )}
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

          <section>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              {SCROLL_OPTIONS.map((scroll) => {
                const selected = selectedScroll === scroll.key;
                const count = Number(scrolls[scroll.key] || 0);
                return (
                  <button
                    key={scroll.key}
                    type="button"
                    onClick={() => setSelectedScroll(scroll.key)}
                    style={{
                      borderRadius: 12, padding: '10px 12px', textAlign: 'left',
                      border: selected ? '1px solid rgba(201,168,76,0.5)' : '1px solid rgba(255,255,255,0.08)',
                      background: selected ? 'rgba(201,168,76,0.1)' : 'rgba(255,255,255,0.03)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, color: selected ? '#c9a84c' : '#94a3b8' }}>
                      {scroll.shortLabel}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{scroll.note}</div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: count > 0 ? '#f8fafc' : '#475569', marginTop: 4 }}>
                      {count}x owned
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {enchantResult ? (
            <section>
              <div style={{
                borderRadius: 14, padding: '12px 14px', marginTop: 12,
                background: enchantResult.destroyed
                  ? 'rgba(239,68,68,0.1)'
                  : enchantResult.success
                  ? 'rgba(34,197,94,0.1)'
                  : 'rgba(148,163,184,0.08)',
                border: `1px solid ${enchantResult.destroyed ? 'rgba(239,68,68,0.3)' : enchantResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(148,163,184,0.2)'}`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>
                  {enchantResult.destroyed ? '💥' : enchantResult.success ? '✨' : '❌'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: enchantResult.destroyed ? '#f87171' : enchantResult.success ? '#4ade80' : '#94a3b8' }}>
                  {enchantResult.destroyed
                    ? `${enchantResult.item_name} was destroyed`
                    : enchantResult.success
                    ? `${enchantResult.item_name} → +${enchantResult.new_enchant_level}`
                    : `Enchant failed — ${enchantResult.item_name} unchanged`}
                </div>
              </div>
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

              <div className="mt-4">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <ScrollImage scroll={SCROLL_OPTIONS.find((scroll) => scroll.key === selectedScroll) || SCROLL_OPTIONS[0]} selected />
                  <p style={{ color: '#e8e0d0', fontSize: 13, fontWeight: 800, margin: 0 }}>
                    {SCROLL_OPTIONS.find((scroll) => scroll.key === selectedScroll)?.shortLabel} x{selectedScrollCount}
                    {selectedScrollShopItem ? ` | ${Number(selectedScrollShopItem.price || 0).toLocaleString()} coins` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleEnchant}
                  disabled={enchanting || !selectedUpgradeItem || selectedScrollCount === 0 || isAtMax}
                  style={{
                    width: '100%',
                    padding: '13px',
                    borderRadius: 14,
                    border: isAtMax ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(201,168,76,0.4)',
                    background: isAtMax
                      ? 'rgba(255,255,255,0.03)'
                      : enchanting
                      ? 'rgba(201,168,76,0.3)'
                      : 'linear-gradient(135deg, rgba(139,0,0,0.8), rgba(201,168,76,0.5))',
                    color: isAtMax ? '#475569' : '#f5e6c0',
                    fontWeight: 900, fontSize: 14, cursor: enchanting || isAtMax || selectedScrollCount === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isAtMax ? 'Max level reached' : enchanting ? 'Enchanting...' : selectedScrollCount === 0 ? 'No scrolls' : `Enchant  ${selectedChance != null ? `— ${Math.round(Number(selectedChance) * 100)}%` : ''}`}
                </button>
                {normalDestroyRisk && (
                  <p style={{ color: '#f87171', fontSize: 11, fontWeight: 700, margin: '6px 0 0', textAlign: 'center' }}>
                    ⚠️ Normal scroll above safe range — item may be destroyed
                  </p>
                )}
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
