import {
  LAST_EUR_AMOUNT_KEY,
  LAST_SOL_EUR_PRICE_KEY,
  LEGACY_LAST_EUR_AMOUNT_KEY,
  LEGACY_LAST_SOL_EUR_PRICE_KEY,
  LEGACY_USER_SESSION_KEY,
  LEGACY_SOCKET_SESSION_KEY,
  USER_SESSION_KEY,
} from './storage';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const API = `${BACKEND_URL}/api`;

const APP_VERSION = '10.0-RISKARENA-20260525';

// SIMPLIFIED VERSION CHECK - NO AUTO RELOAD
// Just update the version in storage, let service worker handle caching
const storedVersion = localStorage.getItem('app_version');
if (storedVersion !== APP_VERSION) {
  console.log(`📦 Version updated: ${storedVersion} → ${APP_VERSION}`);
  localStorage.setItem('app_version', APP_VERSION);
  
  // Clear other cached data (but keep important user data)
  const keysToKeep = [
    LAST_EUR_AMOUNT_KEY,
    LAST_SOL_EUR_PRICE_KEY,
    LEGACY_LAST_EUR_AMOUNT_KEY,
    LEGACY_LAST_SOL_EUR_PRICE_KEY,
    'app_version',
    USER_SESSION_KEY,
    LEGACY_USER_SESSION_KEY,
    LEGACY_SOCKET_SESSION_KEY,
  ];
  const allKeys = Object.keys(localStorage);
  
  allKeys.forEach(key => {
    if (!keysToKeep.includes(key) && !key.startsWith('riskarena:')) {
      localStorage.removeItem(key);
    }
  });
}

const PRIZE_LINKS = {
  bronze: "https://your-prize-link-1.com",
  silver: "https://your-prize-link-2.com", 
  gold: "https://your-prize-link-3.com"
};

const ROOM_CONFIGS = {
  free: {
    name: 'Training Grounds',
    icon: '🏹',
    min: 0,
    max: 0,
    maxPlayers: 3,
    free: true,
    gradient: 'from-emerald-500 to-teal-700'
  },
  bronze: {
    name: 'Dueling Pit',
    label: 'Combat 1v1',
    icon: '⚔️',
    min: 200,
    max: 450,
    min_bet: 200,
    max_bet: 450,
    minPlayers: 2,
    maxPlayers: 2,
    game_mode: 'duel',
    gradient: 'from-amber-600 to-amber-800'
  },
  silver: {
    name: 'Silver Arena',
    icon: '🥈',
    min: 350,
    max: 800,
    maxPlayers: 3,
    gradient: 'from-slate-400 to-slate-600'
  },
  gold: {
    name: 'Golden Arena',
    icon: '🥇',
    min: 650,
    max: 1200,
    maxPlayers: 3,
    gradient: 'from-yellow-400 to-yellow-600'
  },
  freeroll: {
    name: 'Grand Arena',
    icon: '🏟️',
    min: 0,
    max: 0,
    maxPlayers: 30,
    gradient: 'from-emerald-500 to-teal-600'
  },
};

const ROOM_LABELS = {
  bronze: '⚔️ Dueling Pit',
  silver: '🥈 Silver Arena',
  gold: '🥇 Golden Arena',
  free: '🏹 Training Grounds',
  freeroll: '🏟️ Grand Arena',
};

const normalizeRoomType = (rt) => {
  if (!rt) return '';
  const s = String(rt);
  return s.includes('.') ? s.split('.').pop().toLowerCase() : s.toLowerCase();
};

export { API, APP_VERSION, BACKEND_URL, PRIZE_LINKS, ROOM_CONFIGS, ROOM_LABELS, normalizeRoomType };
