import { useCallback, useState } from 'react';
import { fetchRooms } from '../api/roomsApi';

export function useRooms() {
  const [rooms, setRooms] = useState([]);

  const loadRooms = useCallback(async () => {
    const response = await fetchRooms();
    setRooms(response.data.rooms || response.data || []);
    return response;
  }, []);

  return { rooms, setRooms, loadRooms };
}
