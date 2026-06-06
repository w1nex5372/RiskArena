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

export const CLASS_ABILITY_ICONS = {
  warrior: '/items/skills/warrior_guardbreak.png',
  mage: '/items/skills/class_fireball.png',
  rogue: '/items/skills/class_blink.png',
};

export const CLASS_UTILITY_ICONS = {
  warrior: '/items/skills/warrior_guardbreak.png',
  mage: '/items/skills/mage_ember_bolt.png',
  rogue: '/items/skills/rogue_shadowstep.png',
};

function skillFromKey(slotId, source, abilityKey, imagePath) {
  const meta = ABILITY_DATA[abilityKey] || {};
  return {
    slot_id: slotId,
    source,
    ability_key: abilityKey,
    name: meta.label || abilityKey || 'Empty',
    image_path: imagePath || '',
    cooldown_ms: Number(meta.cooldown_ms || 0),
    battle_stats: meta,
  };
}

export function getClassBattleSkills(className, equippedAbility = null) {
  const cls = String(className || '').toLowerCase();
  if (!cls || !CLASS_DATA[cls]) return [null, null, null];
  const defaultKey = CLASS_DEFAULT_ABILITY_KEYS[cls] || `${cls}_default`;
  const utilityKey = CLASS_UTILITY_ABILITY_KEYS[cls] || '';
  const equippedClass = String(equippedAbility?.class_name || '').toLowerCase();
  const validEquippedAbility = equippedAbility && (!equippedClass || equippedClass === 'any' || equippedClass === cls)
    ? equippedAbility
    : null;
  return [
    skillFromKey('class', 'class', defaultKey, CLASS_ABILITY_ICONS[cls]),
    utilityKey ? skillFromKey('utility', 'class', utilityKey, CLASS_UTILITY_ICONS[cls]) : null,
    validEquippedAbility
      ? {
          ...validEquippedAbility,
          slot_id: 'item',
          source: 'item',
          name: validEquippedAbility.name || ABILITY_DATA[validEquippedAbility.ability_key]?.label || 'Item Skill',
          cooldown_ms: Number(
            validEquippedAbility.ability_cooldown_ms ||
            validEquippedAbility.cooldown_ms ||
            ABILITY_DATA[validEquippedAbility.ability_key]?.cooldown_ms ||
            0
          ),
          battle_stats: validEquippedAbility.battle_stats || ABILITY_DATA[validEquippedAbility.ability_key] || {},
        }
      : null,
  ];
}
