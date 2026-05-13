export const CHARACTER_IMAGES = {
  warrior: '/characters/warrior.png',
  mage:    '/characters/mage.png',
  rogue:   '/characters/rogue.png',
};

export const CLASS_INFO = {
  warrior: {
    name: 'Warrior',
    title: 'Son of Ares',
    icon: '⚔️',
    bonus: '+5 Attack, +10 HP',
    bonuses: ['+5 Attack damage', '+10 HP'],
    color: '#8b0000',
    glow: 'rgba(139,0,0,0.5)',
  },
  mage: {
    name: 'Mage',
    title: 'Heir of Zeus',
    icon: '⚡',
    bonus: '+10 Ability, -10 HP',
    bonuses: ['+10 Ability damage', '-10 HP'],
    color: '#4a90d9',
    glow: 'rgba(74,144,217,0.5)',
  },
  rogue: {
    name: 'Rogue',
    title: 'Shadow of Hermes',
    icon: '🗡️',
    bonus: '+15% Risk chance',
    bonuses: ['+15% Risk win chance', 'Fast strikes'],
    color: '#c9a84c',
    glow: 'rgba(201,168,76,0.5)',
  },
};

export function getCharacterImage(className) {
  return CHARACTER_IMAGES[className] || '/characters/warrior.png';
}
