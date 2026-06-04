import { useCallback, useRef } from 'react';

// Returns a callback with a STABLE identity (never changes across renders) that
// always invokes the latest version of `fn`. This lets us pass handlers to
// React.memo'd children without defeating the memo, while avoiding stale-closure
// bugs (the handler always sees current props/state via the ref).
export default function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}
