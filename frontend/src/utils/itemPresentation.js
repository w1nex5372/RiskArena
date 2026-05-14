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

export function getItemImageSrc(item) {
  const explicitPath = item?.image_path || item?.image || item?.icon_path;
  if (explicitPath) return explicitPath;

  const scrollType = String(item?.scroll_type || item?.type || item?.item_id || item?.id || '').trim().toLowerCase();
  if (scrollType === 'normal_scroll') return '/items/normal_scroll.png';
  if (scrollType === 'blessed_scroll') return '/items/blessed_scroll.png';

  const className = getClassKey(item) || 'warrior';
  const slot = getSlotKey(item) || 'weapon';
  const weaponAssetByClass = {
    warrior: 'warrior_sword',
    mage: 'mage_staff',
    rogue: 'rogue_dagger',
  };

  if (slot === 'weapon') {
    return `/items/${weaponAssetByClass[className] || 'warrior_sword'}.png`;
  }

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

export function getPassiveText(item) {
  return String(item?.passive_label || '').trim();
}
