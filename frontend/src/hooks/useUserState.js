import { useRef, useState } from 'react';

export function useUserState(initialUser = null) {
  const [user, setUser] = useState(initialUser);
  const userRef = useRef(initialUser);

  const updateUser = (nextUser) => {
    userRef.current = nextUser;
    setUser(nextUser);
  };

  return { user, setUser: updateUser, userRef };
}
