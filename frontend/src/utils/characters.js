import battleClasses from '../generated/battle_classes.json';

const CLASS_DATA = battleClasses?.classes || {};
const fallbackClass = 'warrior';

export const CHARACTER_CLASSES = Object.keys(CLASS_DATA);

export const CLASS_INFO = Object.fromEntries(
  Object.entries(CLASS_DATA).map(([key, meta]) => [
    key,
    {
      name: meta.label || key,
      title: meta.title || meta.role || key,
      role: meta.role || '',
      roleDescription: meta.role_description || '',
      icon: meta.icon || '',
      bonus: (meta.passives || []).join(', '),
      bonuses: meta.passives || [],
      color: meta.color || '#c9a84c',
      glow: meta.glow || 'rgba(201,168,76,0.5)',
      stats: meta.presentation_stats || {},
      // Base attack damage lives in basic_attack, not presentation_stats — surface it
      // here so display surfaces (e.g. the home class card) can show ATK without
      // reaching into the raw schema. These are base values before weapon/item bonuses.
      attack: {
        min: meta.basic_attack?.damage_min ?? null,
        max: meta.basic_attack?.damage_max ?? null,
        range: meta.basic_attack?.range ?? null,
        backstabMultiplier: meta.basic_attack?.backstab_multiplier ?? null,
      },
    },
  ])
);

export function normalizeCharacterClass(className) {
  const normalized = String(className || '').trim().toLowerCase();
  return CHARACTER_CLASSES.includes(normalized) ? normalized : null;
}

export function getClassInfo(className, fallback = fallbackClass) {
  const normalized = normalizeCharacterClass(className);
  if (normalized) return CLASS_INFO[normalized];
  return fallback ? CLASS_INFO[fallback] || null : null;
}

// Display-only class identity stats. Combat resolution is server-authoritative.
export const CLASS_MODIFIERS = Object.fromEntries(
  Object.entries(CLASS_DATA).map(([key, meta]) => [key, meta.presentation_stats || {}])
);
