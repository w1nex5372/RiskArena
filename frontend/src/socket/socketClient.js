import io from 'socket.io-client';
import { BACKEND_URL } from '../utils/constants';

export const createSocketClient = (options = {}) => io(BACKEND_URL, options);
