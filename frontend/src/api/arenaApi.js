import apiClient from './client';

export const fetchArenaMatch = (matchId) => apiClient.get(`/arena/matches/${matchId}`);

export const submitArenaAction = ({ matchId, userId, roundNumber, action }) =>
  apiClient.post(`/arena/matches/${matchId}/actions`, {
    user_id: userId,
    round_number: roundNumber,
    action,
  });

export const resolveArenaTimeout = (matchId) =>
  apiClient.post(`/arena/matches/${matchId}/resolve-timeout`);
