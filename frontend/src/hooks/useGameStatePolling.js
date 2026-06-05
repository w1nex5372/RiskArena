import { useEffect, useRef } from 'react';
import axios from 'axios';
import { API } from '../utils/constants';

// Polls /api/room/{roomId} every 1s while the user is in a game room — the primary
// mechanism for showing the roulette wheel (socket events are unreliable). Detects
// arena duel matches and hands off via openArenaCombat; otherwise drives the
// roulette ready/finished transitions. Stops itself when the room 404s.
//
// This is the most coupled effect in App.jsx: it reads/writes two refs and ~9
// setters plus two App helpers (extractArenaMatchId/openArenaCombat). To extract it
// without changing behaviour, all of those are passed in an `actions` object that
// is read through a ref — so the effect re-subscribes ONLY when roomId changes
// (matching the original `[activeGameRoomId]` deps) while always calling the latest
// closures (no stale state, no churn). Game state itself stays in App.jsx.
export default function useGameStatePolling(roomId, actions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!roomId) return;

    let lastStatus = '';
    let lastMatchId = '';

    const pollGameState = async () => {
      // Skip while backgrounded; resumes on visibilitychange below.
      if (document.hidden) return;
      const a = actionsRef.current;
      try {
        const response = await axios.get(`${API}/room/${roomId}`);
        const data = response.data;
        const status = data.status;
        const matchId = data.match_id || '';
        const arenaMatchId = a.extractArenaMatchId(data);

        if (arenaMatchId) {
          a.openArenaCombat(arenaMatchId, {
            room_id: roomId,
            room_type: data.room_type,
            players: data.players || [],
            stake_amount: data.bet_amount || data.stake_amount,
          });
          return;
        }

        // Status: ready/playing/finished → show roulette wheel (never for duel rooms)
        const isDuelRoom = data.settings?.game_mode === 'duel';
        if (!isDuelRoom &&
            (status === 'ready' || status === 'playing' || status === 'finished') &&
            lastStatus !== 'ready' && lastStatus !== 'playing' && lastStatus !== 'finished' &&
            !a.showGetReadyRef.current) {
          a.blockWinnerScreenRef.current = false;
          a.showGetReadyRef.current = true;
          a.setInLobby(false);
          a.setLobbyData(null);
          a.setLobbyMessages([]);
          a.setGameInProgress(false);
          a.setShowWinnerScreen(false);
          a.setWinnerData(null);
          a.setForceHideLobby(true);
          a.setRouletteConfig({ players: data.players || [], winner: null });
        }

        // Status: finished + winner → inject winner into roulette (never for duel rooms)
        if (!isDuelRoom && status === 'finished' && data.winner && matchId && matchId !== lastMatchId) {
          if (a.showGetReadyRef.current) {
            lastMatchId = matchId;
            a.setShownMatchIds((prev) => new Set([...prev, matchId]));
            a.setRouletteConfig((prev) => prev ? { ...prev, winner: data.winner } : prev);
          }
        }

        lastStatus = status;
      } catch (e) {
        // Room gone (game ended, room reset) — stop polling
        if (e.response && e.response.status === 404) {
          clearInterval(interval);
        }
      }
    };

    const interval = setInterval(pollGameState, 1000);
    pollGameState(); // immediate first check
    // Poll immediately when app returns to foreground (don't wait for next tick)
    const onVisible = () => { if (!document.hidden) pollGameState(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [roomId]); // actions read via ref → no re-subscribe churn
}
