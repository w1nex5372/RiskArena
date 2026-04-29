"""
Socket.IO Room Management
Handles client room joining/leaving and targeted broadcasting
"""

import logging
from typing import Dict, Set

logger = logging.getLogger(__name__)

# Track which socket is in which room
socket_to_room: Dict[str, str] = {}  # sid -> room_id
room_to_sockets: Dict[str, Set[str]] = {}  # room_id -> set of sids

async def join_socket_room(sio, sid: str, room_id: str):
    """
    Make a socket join a Socket.IO room
    
    Args:
        sio: Socket.IO server instance
        sid: Socket ID
        room_id: Room ID to join
    """
    # Leave previous room if any
    if sid in socket_to_room:
        old_room = socket_to_room[sid]
        await leave_socket_room(sio, sid, old_room)
    
    # Join new room
    await sio.enter_room(sid, room_id)
    socket_to_room[sid] = room_id
    
    if room_id not in room_to_sockets:
        room_to_sockets[room_id] = set()
    room_to_sockets[room_id].add(sid)
    
    logger.info(f"Socket {sid[:8]} joined room {room_id}. Room now has {len(room_to_sockets[room_id])} sockets")

async def leave_socket_room(sio, sid: str, room_id: str = None):
    """
    Make a socket leave a Socket.IO room
    
    Args:
        sio: Socket.IO server instance
        sid: Socket ID
        room_id: Optional room ID (if not provided, leaves current room)
    """
    if room_id is None:
        room_id = socket_to_room.get(sid)
    
    if not room_id:
        return
    
    await sio.leave_room(sid, room_id)
    
    if sid in socket_to_room:
        del socket_to_room[sid]
    
    if room_id in room_to_sockets:
        room_to_sockets[room_id].discard(sid)
        if not room_to_sockets[room_id]:
            del room_to_sockets[room_id]
        else:
            logger.info(f"Socket {sid[:8]} left room {room_id}. Room now has {len(room_to_sockets[room_id])} sockets")

async def broadcast_to_room(sio, room_id: str, event: str, data: dict):
    """
    Broadcast an event to all sockets in a specific room
    
    Args:
        sio: Socket.IO server instance
        room_id: Room ID to broadcast to
        event: Event name
        data: Event data
    """
    sockets_in_room = room_to_sockets.get(room_id, set())
    logger.info(f"Broadcasting '{event}' to room {room_id} ({len(sockets_in_room)} sockets)")
    
    if sockets_in_room:
        await sio.emit(event, data, room=room_id)
        logger.info(f"✅ Broadcast complete: {event} -> room {room_id}")
    else:
        logger.warning(f"⚠️ No sockets in room {room_id} for event {event}")

def get_room_socket_count(room_id: str) -> int:
    """Get number of connected sockets in a room"""
    return len(room_to_sockets.get(room_id, set()))

def cleanup_socket(sid: str):
    """Clean up socket tracking on disconnect"""
    if sid in socket_to_room:
        room_id = socket_to_room[sid]
        if room_id in room_to_sockets:
            room_to_sockets[room_id].discard(sid)
            if not room_to_sockets[room_id]:
                del room_to_sockets[room_id]
        del socket_to_room[sid]
        logger.info(f"Cleaned up socket {sid[:8]} from room {room_id}")
