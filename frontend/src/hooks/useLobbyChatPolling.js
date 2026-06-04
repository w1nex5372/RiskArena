import { useEffect } from 'react';
import axios from 'axios';
import { API } from '../utils/constants';

// Polls lobby chat history every 1.5s while the user is in a lobby (a fallback for
// missed socket `lobby_message` events). Side-effect only — the lobbyMessages
// state stays in App.jsx because it's also written by the socket handler and
// cleared on lobby exit, so this hook just receives the stable setter.
// Extracted from App.jsx (de-monolith). Server response is the source of truth.
export default function useLobbyChatPolling(inLobby, roomId, setLobbyMessages) {
  useEffect(() => {
    if (!inLobby || !roomId) return;
    const fetchChat = async () => {
      try {
        const res = await axios.get(`${API}/room-chat/${roomId}`);
        const msgs = res.data.messages || [];
        setLobbyMessages(msgs.slice(-50));
      } catch (_) {}
    };
    fetchChat();
    const interval = setInterval(fetchChat, 1500);
    return () => clearInterval(interval);
  }, [inLobby, roomId, setLobbyMessages]);
}
