import apiClient from './client';

export const fetchUser = (userId) => apiClient.get(`/user/${userId}`);
export const fetchUserByTelegramId = (telegramId) => apiClient.get(`/users/telegram/${telegramId}`);
export const authenticateTelegram = (payload) => apiClient.post('/auth/telegram', payload);
export const fetchUserStats = (userId) => apiClient.get(`/user-stats/${userId}`);
export const fetchUserPrizes = (userId) => apiClient.get(`/user/${userId}/prizes`);
