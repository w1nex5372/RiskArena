import axios from 'axios';
import { API, BACKEND_URL } from '../utils/constants';
import { getStoredUser } from '../utils/storage';

const apiClient = axios.create({ baseURL: API, withCredentials: true });

// Attach session token from localStorage to every request
apiClient.interceptors.request.use((config) => {
  try {
    const userData = getStoredUser();
    const token = userData.session_token;
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
  } catch {}
  return config;
});

export { API, BACKEND_URL, apiClient };
export default apiClient;
