import { useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { API } from '../utils/constants';

// Polls the participant list for the current lobby every 2s (fallback for missed
// player_joined/left socket events) and keeps lobbyData's min/max players in sync.
// Side-effect only: roomParticipants and lobbyData stay in App.jsx (written by
// socket handlers too), so this hook receives their stable setters.
//
// Re-subscribes only on inLobby / room_type change (NOT the whole lobbyData object,
// which the poll itself mutates via setLobbyData — that would restart the interval
// every tick). The latest lobbyData is read through a ref for the min_players
// fallback, so there's no stale-closure. Extracted from App.jsx (de-monolith).
export default function useLobbyParticipantsPolling(inLobby, lobbyData, setRoomParticipants, setLobbyData) {
  const lobbyDataRef = useRef(lobbyData);
  lobbyDataRef.current = lobbyData;
  const roomType = lobbyData?.room_type;

  useEffect(() => {
    if (!inLobby || !roomType) return;
    let pollCount = 0;

    const fetchParticipants = async () => {
      if (document.hidden) return; // don't poll while backgrounded
      pollCount++;
      try {
        const response = await axios.get(`${API}/room-participants/${roomType}`);
        const players = response.data.players || [];

        setRoomParticipants((prev) => ({ ...prev, [roomType]: players }));

        if (response.data.min_players || response.data.max_players) {
          setLobbyData((prev) => prev ? { ...prev, min_players: response.data.min_players, max_players: response.data.max_players } : prev);
        }

        const minNeeded = response.data.min_players || lobbyDataRef.current?.min_players || 3;
        // game_finished socket event handles winner display from here.
        if (players.length >= minNeeded) {
          toast.success('🎰 Room Full! Game starting...', { id: `room-full-${roomType}`, duration: 3000 });
        }
      } catch (error) {
        if (pollCount === 1) toast.error('Failed to load players. Retrying...');
      }
    };

    fetchParticipants();
    const pollInterval = setInterval(fetchParticipants, 2000);
    return () => clearInterval(pollInterval);
  }, [inLobby, roomType, setRoomParticipants, setLobbyData]);
}
