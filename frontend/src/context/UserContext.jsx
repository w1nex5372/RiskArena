// Single source of truth for the authenticated user, exposed via React context.
//
// Step 1 of the App.jsx de-monolithing: the `user` state still LIVES in App.jsx
// for now (so the 44 existing setUser call sites keep working untouched), but it
// is published here so leaf components can read it via useUser() instead of being
// prop-drilled. Combined with React.memo on those leaves, this stops them from
// re-rendering on every unrelated App.jsx state change (e.g. the 2s lobby poll).
//
// The context value identity only changes when `user` changes — setUser is kept
// referentially stable via a ref — so memoized consumers that read only setUser
// never re-render, and those reading user re-render only when user actually changes.

import { createContext, useCallback, useContext, useMemo, useRef } from 'react';

const UserContext = createContext({ user: null, setUser: () => {} });

export function UserProvider({ user, setUser, children }) {
  // Keep the latest setUser without making it part of the memo identity.
  const setUserRef = useRef(setUser);
  setUserRef.current = setUser;
  const stableSetUser = useCallback((next) => setUserRef.current(next), []);

  const value = useMemo(() => ({ user, setUser: stableSetUser }), [user, stableSetUser]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

// Read the current user (and a stable setUser) from context.
export function useUser() {
  return useContext(UserContext);
}

export default UserContext;
