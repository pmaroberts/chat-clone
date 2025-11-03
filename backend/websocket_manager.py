from typing import Dict, Set
from fastapi import WebSocket
from uuid import UUID
import logging
from collections import defaultdict

# Set up logging
logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages WebSocket connections for real-time messaging"""

    def __init__(self):
        # maps conversation id to the WebSocket connections
        self.active_connections: Dict[UUID, Set[WebSocket]] = defaultdict(set)

        # maps WebSocket to user id
        self.user_connections: Dict[WebSocket, UUID] = {}

        # maps user id to Web Socket
        self.user_websockets: Dict[UUID, Set[WebSocket]] = defaultdict(set)


    async def connect(self, websocket: WebSocket, conversation_id: UUID, user_id: UUID):
        """Connect a user to a conversation"""
        # Note: websocket.accept() is now called in the endpoint before calling this
        
        self.active_connections[conversation_id].add(websocket)
        self.user_connections[websocket] = user_id
        self.user_websockets[user_id].add(websocket)
        
        logger.info(f"User {user_id} connected to conversation {conversation_id}")

        await self.broadcast_presence(conversation_id, user_id, is_online=True, exclude_websocket=websocket)

    
    def disconnect(self, websocket: WebSocket, conversation_id: UUID):
        """Disconnect a user from a conversation"""
        if websocket in self.active_connections[conversation_id]:
            self.active_connections[conversation_id].discard(websocket)

        if websocket in self.user_connections:
            user_id = self.user_connections[websocket]
            if user_id in self.user_websockets:
                self.user_websockets[user_id].discard(websocket)
            del self.user_connections[websocket]

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Send message to specific connection"""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Error sending personal message: {e}", exc_info=True)

    async def broadcast_to_conversation(
        self,
        message: dict,
        conversation_id: UUID,
        exclude_websocket: WebSocket = None,
        exclude_user_id: UUID = None
    ):
        """Broadcast message to all users in a conversation"""
        if conversation_id not in self.active_connections:
            return

        disconnected = set()
        for connection in self.active_connections[conversation_id]:
            if connection == exclude_websocket:
                continue
            if exclude_user_id and self.user_connections.get(connection) == exclude_user_id:
                continue

            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to connection: {e}", exc_info=True)
                disconnected.add(connection)

        for connection in disconnected:
            if conversation_id in self.active_connections:
                self.disconnect(connection, conversation_id)

    async def broadcast_presence(
        self,
        conversation_id: UUID,
        user_id: UUID,
        is_online: bool,
        exclude_websocket: WebSocket = None
    ):
        """Broadcast user presence (online/offline) to conversation"""
        message = {
            "type": "presence",
            "conversation_id": str(conversation_id),
            "user_id": str(user_id),
            "is_online": is_online
        }

        await self.broadcast_to_conversation(
            message,
            conversation_id,
            exclude_websocket=exclude_websocket
        )


manager = ConnectionManager()