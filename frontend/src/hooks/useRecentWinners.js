import { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/constants';

// Polls the 5 most recent game winners every 10s while a user is present,
// skipping while the app is backgrounded. Extracted from App.jsx (de-monolith).
// Uses the same global axios instance App configures (interceptor + credentials),
// so auth behaviour is identical to the original inline effect.
export default function useRecentWinners(user) {
  const [recentWinners, setRecentWinners] = useState([]);

  useEffect(() => {
    if (!user) return;
    const fetchWinners = async () => {
      if (document.hidden) return; // don't poll while backgrounded
      try {
        const res = await axios.get(`${API}/game-history?limit=5`);
        setRecentWinners(res.data.games || []);
      } catch (e) {}
    };
    fetchWinners();
    const interval = setInterval(fetchWinners, 10000);
    return () => clearInterval(interval);
  }, [user]);

  return recentWinners;
}
