export const USER_SESSION_KEY = 'riskarena_user';
export const LEGACY_USER_SESSION_KEY = 'casino_user';
export const LEGACY_SOCKET_SESSION_KEY = 'casino_user_session';
export const LAST_EUR_AMOUNT_KEY = 'riskarena_last_eur_amount';
export const LAST_SOL_EUR_PRICE_KEY = 'riskarena_last_sol_eur_price';
export const LEGACY_LAST_EUR_AMOUNT_KEY = 'casino_last_eur_amount';
export const LEGACY_LAST_SOL_EUR_PRICE_KEY = 'casino_last_sol_eur_price';

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

export function getStoredUser() {
  const current = readJson(USER_SESSION_KEY);
  if (current?.id || current?.session_token) return current;

  const legacy = readJson(LEGACY_USER_SESSION_KEY);
  if (legacy?.id || legacy?.session_token) {
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(legacy));
    return legacy;
  }

  const socketLegacy = readJson(LEGACY_SOCKET_SESSION_KEY);
  if (socketLegacy?.id || socketLegacy?.session_token) {
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(socketLegacy));
    return socketLegacy;
  }

  return {};
}

export function getStoredSessionToken() {
  return getStoredUser()?.session_token || '';
}

export function saveStoredUser(userData) {
  const current = getStoredUser();
  const next = {
    ...current,
    ...(userData || {}),
  };

  // Profile/balance refresh endpoints intentionally do not return a new token.
  // Keep the active session unless auth explicitly supplies a replacement.
  if (!next.session_token && current.session_token) {
    next.session_token = current.session_token;
  }

  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(next));
}

export function clearStoredUser() {
  localStorage.removeItem(USER_SESSION_KEY);
  localStorage.removeItem(LEGACY_USER_SESSION_KEY);
  localStorage.removeItem(LEGACY_SOCKET_SESSION_KEY);
}

export function getStoredNumber(key, legacyKey, fallback) {
  const current = localStorage.getItem(key);
  if (current != null) return parseFloat(current);

  const legacy = localStorage.getItem(legacyKey);
  if (legacy != null) {
    localStorage.setItem(key, legacy);
    return parseFloat(legacy);
  }

  return fallback;
}

export function setStoredValue(key, value, legacyKey = null) {
  localStorage.setItem(key, value);
  if (legacyKey) localStorage.removeItem(legacyKey);
}
