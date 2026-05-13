import apiClient from './client';

export const fetchRooms = () => apiClient.get('/rooms');
export const fetchRoomConfigs = () => apiClient.get('/room-configs');
export const fetchRoomParticipants = (roomType) => apiClient.get(`/room-participants/${roomType}`);
export const joinRoom = (payload) => apiClient.post('/join-room', payload);
export const leaveRoom = (payload) => apiClient.post('/leave-room', payload);
export const fetchUserRoomStatus = (userId) => apiClient.get(`/user-room-status/${userId}`);
