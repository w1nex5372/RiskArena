import ABILITY_CONFIG from '../generated/battle_abilities.json';
import CLASS_CONFIG from '../generated/battle_classes.json';

const ABILITY_DATA = ABILITY_CONFIG?.abilities || {};
const CLASS_DATA = CLASS_CONFIG?.classes || {};

export const CLASS_DEFAULT_ABILITY_KEYS = Object.fromEntries(
  Object.entries(CLASS_DATA).map(([classKey, meta]) => [classKey, meta.default_ability_key || `${classKey}_default`])
);

export const CLASS_UTILITY_ABILITY_KEYS = Object.fromEntries(
  Object.entries(CLASS_DATA).map(([classKey, meta]) => [classKey, meta.utility_ability_key || ''])
);

export const CLASS_COOLDOWNS = Object.fromEntries(
  Object.entries(CLASS_DEFAULT_ABILITY_KEYS).map(([classKey, abilityKey]) => [
    classKey,
    Number(ABILITY_DATA[abilityKey]?.cooldown_ms || 6000),
  ])
);

export const UTILITY_COOLDOWNS = Object.fromEntries(
  Object.entries(CLASS_UTILITY_ABILITY_KEYS).map(([classKey, abilityKey]) => [
    classKey,
    Number(ABILITY_DATA[abilityKey]?.cooldown_ms || 10000),
  ])
);

// Slot 1 = mobility (dash/teleport/blink)
export const CLASS_ABILITY_ICONS = {
  warrior: '/items/skills/warrior_guardbreak.png', // war-dash (no dedicated icon yet)
  mage:    '/items/skills/mage_ember_bolt.png',    // phase-step (no dedicated icon yet)
  rogue:   '/items/skills/class_blink.png',        // blink ✅
};

// Slot 2 = damage
export const CLASS_UTILITY_ICONS = {
  warrior: '/items/skills/warrior_guardbreak.png', // guardbreak
  mage:    '/items/skills/class_fireball.png',     // fireball
  rogue:   '/items/skills/rogue_shadowstep.png',   // execute
};

export const ABILITY_ICON_BY_KEY = {
  warrior_default: '/items/skills/class_bash.png',
  warrior_bash: '/items/skills/warrior_bash.png',
  warrior_guardbreak: '/items/skills/warrior_guardbreak.png',
  warrior_titan_bash: '/items/skills/warrior_titan_bash.png',
  warrior_fortify: '/items/skills/warrior_guardbreak.png',
  warrior_shield_dash: '/items/skills/warrior_bash.png',
  warrior_dash: '/items/skills/class_bash.png',
  mage_default: '/items/skills/class_fireball.png',
  mage_fireball: '/items/skills/mage_fireball.png',
  mage_ember_bolt: '/items/skills/mage_ember_bolt.png',
  mage_inferno_blast: '/items/skills/mage_inferno_blast.png',
  mage_phase_step: '/items/skills/mage_ember_bolt.png',
  mage_frost_nova: '/items/skills/class_fireball.png',
  rogue_default: '/items/skills/class_blink.png',
  rogue_blink: '/items/skills/rogue_blink.png',
  rogue_shadowstep: '/items/skills/rogue_shadowstep.png',
  rogue_nightfall: '/items/skills/rogue_nightfall.png',
  rogue_smoke_veil: '/items/skills/rogue_shadowstep.png',
  rogue_execute: '/items/skills/rogue_nightfall.png',
};

export function abilityIconForKey(abilityKey, fallback = '') {
  return ABILITY_ICON_BY_KEY[String(abilityKey || '')] || fallback || '';
}

function skillFromKey(slotId, source, abilityKey, imagePath) {
  const meta = ABILITY_DATA[abilityKey] || {};
  return {
    slot_id: slotId,
    source,
    ability_key: abilityKey,
    name: meta.label || abilityKey || 'Empty',
    image_path: abilityIconForKey(abilityKey, imagePath),
    cooldown_ms: Number(meta.cooldown_ms || 0),
    battle_stats: meta,
  };
}

function equippedSkill(slotId, equippedAbility, className) {
  const equippedClass = String(equippedAbility?.class_name || '').toLowerCase();
  const validEquippedAbility = equippedAbility && (
    !equippedClass || equippedClass === 'any' || equippedClass === className
  )
    ? equippedAbility
    : null;
  if (!validEquippedAbility) return null;
  return {
    ...validEquippedAbility,
    slot_id: slotId,
    source: 'item',
    name: validEquippedAbility.name || ABILITY_DATA[validEquippedAbility.ability_key]?.label || 'Item Skill',
    image_path: abilityIconForKey(validEquippedAbility.ability_key, validEquippedAbility.image_path),
    cooldown_ms: Number(
      validEquippedAbility.ability_cooldown_ms ||
      validEquippedAbility.cooldown_ms ||
      ABILITY_DATA[validEquippedAbility.ability_key]?.cooldown_ms ||
      0
    ),
    battle_stats: validEquippedAbility.battle_stats || ABILITY_DATA[validEquippedAbility.ability_key] || {},
  };
}

export function getClassBattleSkills(className, equippedAbility = null, equippedAbility2 = null) {
  const cls = String(className || '').toLowerCase();
  if (!cls || !CLASS_DATA[cls]) return [null, null, null];
  const defaultKey = CLASS_DEFAULT_ABILITY_KEYS[cls] || `${cls}_default`;
  return [
    skillFromKey('class', 'class', defaultKey, CLASS_ABILITY_ICONS[cls]),
    equippedSkill('ability_2', equippedAbility2, cls),
    equippedSkill('item', equippedAbility, cls),
  ];
}
