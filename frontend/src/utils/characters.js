export const CHARACTER_IMAGES = {
  warrior: '/characters/warrior_sheet.png',
  mage: '/characters/mage_sheet.png',
  rogue: '/characters/rogue_sheet.png',
};

export const CLASS_INFO = {
  warrior: {
    name: 'Warrior',
    title: 'Son of Ares',
    icon: '\u2694\uFE0F',
    bonus: '+3 Attack, +15 HP',
    bonuses: ['+3 Attack damage', '+15 HP'],
    color: '#8b0000',
    glow: 'rgba(139,0,0,0.5)',
  },
  mage: {
    name: 'Mage',
    title: 'Heir of Zeus',
    icon: '\u26A1',
    bonus: '+8 Ability, -10 HP',
    bonuses: ['+8 Ability damage', '-10 HP'],
    color: '#4a90d9',
    glow: 'rgba(74,144,217,0.5)',
  },
  rogue: {
    name: 'Rogue',
    title: 'Shadow of Hermes',
    icon: '\uD83D\uDDE1\uFE0F',
    bonus: '+15% Risk chance',
    bonuses: ['+15% Risk win chance', 'Fast strikes'],
    color: '#c9a84c',
    glow: 'rgba(201,168,76,0.5)',
  },
};

export function normalizeCharacterClass(className) {
  const normalized = String(className || '').trim().toLowerCase();
  return CHARACTER_IMAGES[normalized] ? normalized : null;
}

export function getClassInfo(className, fallbackClass = 'warrior') {
  const normalized = normalizeCharacterClass(className);
  if (normalized) return CLASS_INFO[normalized];
  return fallbackClass ? CLASS_INFO[fallbackClass] || null : null;
}

export function getCharacterImage(className, fallbackClass = 'warrior') {
  const normalized = normalizeCharacterClass(className);
  if (normalized) return CHARACTER_IMAGES[normalized];
  return fallbackClass ? CHARACTER_IMAGES[fallbackClass] || null : null;
}

export const CLASS_MODIFIERS = {
  warrior: { attack_bonus: 3, hp_bonus: 15 },
  mage: { ability_bonus: 8, hp_bonus: -10 },
  rogue: { risk_win_chance: 0.15 },
};
