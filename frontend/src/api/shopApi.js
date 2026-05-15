import apiClient from './client';

export const fetchPurchaseHistory = (userId, limit = 10, offset = 0) =>
  apiClient.get(`/purchase-history/${userId}?limit=${limit}&offset=${offset}`);

export const usePromoCode = (code) =>
  apiClient.post(`/use-promo?code=${encodeURIComponent(code)}`);
