import { useEffect, useState } from 'react';
import { createSocketClient } from '../socket/socketClient';

export function useSocket(options) {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const nextSocket = createSocketClient(options);
    setSocket(nextSocket);
    return () => nextSocket.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return socket;
}
