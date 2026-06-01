export const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const TIER_LABEL = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

export const TIER_THEME = {
  common: {
    color: '#94a3b8',
    border: 'rgba(148,163,184,0.24)',
    soft: 'rgba(148,163,184,0.12)',
    glow: 'rgba(148,163,184,0.14)',
  },
  uncommon: {
    color: '#22c55e',
    border: 'rgba(34,197,94,0.28)',
    soft: 'rgba(34,197,94,0.12)',
    glow: 'rgba(34,197,94,0.14)',
  },
  rare: {
    color: '#3b82f6',
    border: 'rgba(59,130,246,0.28)',
    soft: 'rgba(59,130,246,0.12)',
    glow: 'rgba(59,130,246,0.14)',
  },
  epic: {
    color: '#a855f7',
    border: 'rgba(168,85,247,0.34)',
    soft: 'rgba(168,85,247,0.14)',
    glow: 'rgba(168,85,247,0.22)',
  },
  legendary: {
    color: '#c9a84c',
    border: 'rgba(201,168,76,0.42)',
    soft: 'rgba(201,168,76,0.18)',
    glow: 'rgba(201,168,76,0.26)',
  },
};

export const CLASS_THEME = {
  warrior: { bg: 'rgba(127,29,29,0.18)', color: '#f87171' },
  mage: { bg: 'rgba(30,64,175,0.18)', color: '#60a5fa' },
  rogue: { bg: 'rgba(146,64,14,0.18)', color: '#fbbf24' },
};

export function getTierKey(item) {
  return String(item?.tier || item?.rarity || '').trim().toLowerCase();
}

export function getTierTheme(item) {
  return TIER_THEME[getTierKey(item)] || TIER_THEME.common;
}

export function getTierLabel(item) {
  return TIER_LABEL[getTierKey(item)] || item?.rarity || 'Common';
}

export function getSlotKey(item) {
  return String(item?.slot || item?.category || item?.type || '').trim().toLowerCase();
}

export function getClassKey(item) {
  return String(item?.class_name || '').trim().toLowerCase();
}

export function formatSlotLabel(value) {
  const slot = String(value || '').trim().toLowerCase();
  if (!slot) return '';
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

export function formatClassLabel(value) {
  const className = String(value || '').trim().toLowerCase();
  if (!className) return '';
  return className.charAt(0).toUpperCase() + className.slice(1);
}

// Remap legacy DB image_path values that point to files that no longer exist
const IMAGE_PATH_REMAP = {
  '/items/warrior_sword.png': '/items/warrior_katana.png',
  '/items/rogue_dagger.png':  '/items/rogue_scimitar.png',
};

const LPC_WEAPON_SHEETS = new Set([
  '/items/warrior_katana.png',
  '/items/mage_staff.png',
  '/items/rogue_scimitar.png',
]);

const LPC_FRAME_W = 64;
const LPC_FRAME_H = 64;

// Per-sheet dimensions (width × height in pixels)
const LPC_SHEET_DIMS = {
  '/items/warrior_katana.png': [1152, 4480],
  '/items/mage_staff.png':     [1536, 4224],
  '/items/rogue_scimitar.png': [1152, 4480],
};

// Per-weapon icon frame: row/col/crop tuned by visual inspection of each sheet.
// warrior/rogue: row 67 = east-attack mid-swing (sword extended to the right, most prominent).
// mage: rows 0-3 at the TOP of the sheet are a thrust/walk block with clear vertical staff shapes;
//        row 3 col 6 = east thrust, staff extended to the right.
const LPC_ICON_CONFIG = {
  '/items/warrior_katana.png':  { row: 67, col: 2, crop: 64 },
  '/items/mage_staff.png':      { row: 3,  col: 6, crop: 64 },
  '/items/rogue_scimitar.png':  { row: 67, col: 2, crop: 64 },
};

export function getWeaponSpriteStyle(item, size) {
  const path = item?.image_path;
  if (!path || !LPC_WEAPON_SHEETS.has(path)) return null;
  const [sheetW, sheetH] = LPC_SHEET_DIMS[path] || [1152, 4480];
  const { row, col, crop } = LPC_ICON_CONFIG[path] || { row: 67, col: 2, crop: 64 };
  const scale = size / crop;
  const frameX = col * LPC_FRAME_W;
  const frameY = row * LPC_FRAME_H;
  return {
    backgroundImage: `url(${path})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `-${frameX * scale}px -${frameY * scale}px`,
    backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
    imageRendering: 'pixelated',
  };
}

export function getItemImageSrc(item) {
  // Scrolls first — they have no slot field
  const scrollType = String(item?.scroll_type || item?.type || item?.item_id || item?.id || '').trim().toLowerCase();
  if (scrollType === 'normal_scroll') return '/items/normal_scroll.png';
  if (scrollType === 'blessed_scroll') return '/items/blessed_scroll.png';

  const slot = getSlotKey(item);

  // Weapon PNGs in /items/ are LPC battle spritesheets, not item icons — use fallback icon
  if (!slot || slot === 'weapon') return null;

  const explicitPath = item?.image_path || item?.image || item?.icon_path;
  if (explicitPath) return IMAGE_PATH_REMAP[explicitPath] || explicitPath;

  const className = getClassKey(item) || 'warrior';
  return `/items/${className}_${slot}.png`;
}

export const STAT_LABELS = {
  attack_bonus: 'ATK',
  ability_bonus: 'Ability',
  defend_reduction: 'Defense',
  hp_bonus: 'HP',
  risk_win_chance: 'Risk',
  bonus_attack_percent: 'ATK',
  bonus_ability_percent: 'Ability',
  damage_reduction_percent: 'Damage Reduction',
  risk_success_bonus: 'Risk',
  boss_damage_percent: 'Boss Damage',
  lifesteal_percent: 'Lifesteal',
  base_hp: 'Base HP',
  move_speed: 'Speed',
  guard_max: 'Guard',
  attack_range: 'Range',
  backstab_bonus_percent: 'Backstab',
};

const PERCENT_STATS = new Set([
  'defend_reduction',
  'risk_win_chance',
  'bonus_attack_percent',
  'bonus_ability_percent',
  'damage_reduction_percent',
  'risk_success_bonus',
  'boss_damage_percent',
  'lifesteal_percent',
  'backstab_bonus_percent',
]);

export function formatStatValue(stat, value) {
  const number = Number(value || 0);
  if (!number) return '';
  if (PERCENT_STATS.has(stat)) {
    const pct = Math.round(number * 100);
    return pct < 0 ? `${pct}%` : `+${pct}%`;
  }
  const int = Math.round(number);
  return int < 0 ? `${int}` : `+${int}`;
}

export function formatStatLabel(stat, value, { slotLabel = '' } = {}) {
  const formatted = formatStatValue(stat, value);
  if (!formatted) return '';
  const label = STAT_LABELS[stat] || stat;
  return [formatted, slotLabel, label].filter(Boolean).join(' ');
}

export function getStatEntries(stats, options = {}) {
  if (!stats || typeof stats !== 'object') return [];
  return Object.entries(stats)
    .map(([stat, value]) => ({
      key: stat,
      stat,
      value,
      label: formatStatLabel(stat, value, options),
    }))
    .filter((entry) => entry.label);
}

export function getItemStatRows(item, { source = 'effective_stats', slotPrefix = false } = {}) {
  if (!item) return [];
  if (source === 'effective_stats' && Array.isArray(item.stat_summary) && item.stat_summary.length) {
    return item.stat_summary
      .filter((entry) => entry?.label)
      .map((entry) => ({
        key: entry.stat || entry.label,
        stat: entry.stat,
        value: entry.value,
        label: entry.label,
      }));
  }

  const slotLabel = slotPrefix ? formatSlotLabel(getSlotKey(item)) : '';
  return getStatEntries(item[source], { slotLabel });
}

export function getItemBonusChips(item, slotLabel) {
  const prefix = slotLabel ? `${slotLabel} ` : '';
  return getItemStatChips(item).map((chip) => ({
    ...chip,
    label: `${prefix}${chip.label}`,
  }));
}

export function getItemStatChips(item) {
  const authoritativeRows = getItemStatRows(item);
  if (authoritativeRows.length) return authoritativeRows;

  const chips = getStatEntries({
    attack_bonus: item?.attack_bonus,
    ability_bonus: item?.ability_bonus,
    hp_bonus: item?.hp_bonus,
    defend_reduction: Number(item?.defend_reduction || 0) / 100,
    risk_win_chance: item?.risk_win_chance,
  });

  return chips;
}

function formatSeconds(ms) {
  const seconds = Number(ms || 0) / 1000;
  if (!seconds) return '';
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

export function getAbilityBattleRows(item, { abilityBonus = 0 } = {}) {
  const stats = item?.battle_stats || item?.active_ability_stats || null;
  if (!stats || typeof stats !== 'object') return [];

  const rows = [];
  const damage = Number(stats.damage || 0);
  const stunMs = Number(stats.stun_ms || 0);
  const knockback = Number(stats.knockback || 0);
  const range = Number(stats.range || 0);
  const offset = Number(stats.offset || 0);
  const cooldownMs = Number(stats.cooldown_ms || item?.ability_cooldown_ms || 0);

  if (damage) rows.push({ key: 'damage', label: `${Math.round(damage + Number(abilityBonus || 0))} DMG` });
  if (stunMs) rows.push({ key: 'stun', label: `Stun ${formatSeconds(stunMs)}` });
  if (knockback) rows.push({ key: 'knockback', label: `Knockback ${Math.round(knockback)}` });
  if (range) rows.push({ key: 'range', label: `Range ${Math.round(range)}` });
  if (offset) rows.push({ key: 'offset', label: `Reposition ${Math.round(offset)}` });
  if (cooldownMs) rows.push({ key: 'cooldown', label: `CD ${formatSeconds(cooldownMs)}` });
  if (stats.ignore_block) rows.push({ key: 'ignore_block', label: 'Ignores block' });

  return rows;
}

export function getPassiveText(item) {
  return String(item?.passive_label || '').trim();
}

export function getEnchantColor(level) {
  const n = Number(level || 0);
  if (n >= 10) return '#ff2200';
  if (n >= 6)  return '#aa00ff';
  if (n >= 1)  return '#3399ff';
  return '#c9a84c';
}

export function getEnchantLabel(level) {
  const n = Number(level || 0);
  return n > 0 ? `+${n}` : '';
}
