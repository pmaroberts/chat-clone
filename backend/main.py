from fastapi import FastAPI, Depends, HTTPException, status, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from database import get_db
from models import User, Conversation, ConversationParticipant, Message, MessageReaction, MessageRead
from schemas import UserCreate, UserResponse, UserLogin, Token, ConversationCreate, ConversationResponse, MessageCreate, MessageResponse, MessageListResponse, MessageReactionCreate
from auth import verify_password, get_password_hash, create_access_token, verify_token
from websocket_manager import manager
from datetime import datetime
from uuid import UUID
from typing import List, Optional
from collections import defaultdict
from dotenv import load_dotenv
from jose import jwt, JWTError
from auth import SECRET_KEY as JWT_SECRET_KEY
import os
import logging

load_dotenv()

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Use the same SECRET_KEY and ALGORITHM as auth.py for token verification
# Import after load_dotenv() so environment variables are loaded
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

app = FastAPI(title="Chat Clone API")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

async def verify_token_websocket(token: str) -> User:
    """Verify JWT token from WebSocket connection"""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise JWTError("Token missing subject")
    except JWTError as e:
        logger.error(f"JWT decode error: {e}")
        raise HTTPException(status_code=401, detail="Invalid Token")
    
    db = next(get_db())
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.websocket("/ws/conversations/{conversation_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    conversation_id: UUID,
    token: str = None
):
    """
    WebSocket endpoint for real time messaging

    Connect with: ws//localhost:8000/ws/conversations/{id}?token=JWT_TOKEN
    """
    logger.info(f"WebSocket connection attempt to conversation {conversation_id}")
    
    query_params = dict(websocket.query_params)
    token = query_params.get("token")

    if not token:
        logger.warning(f"No token provided for WebSocket connection to {conversation_id}")
        await websocket.close(code=1008, reason="No token provided")
        return

    logger.debug(f"Token received, length: {len(token)}")
    
    try:
        user = await verify_token_websocket(token)
        logger.info(f"User authenticated: {user.id} (email: {user.email})")
    except HTTPException as e:
        logger.error(f"Authentication failed: {e.detail} (status: {e.status_code})")
        await websocket.close(code=1008, reason=f"Unauthorized: {e.detail}")
        return
    except Exception as e:
        logger.error(f"Unexpected error during authentication: {e}", exc_info=True)
        await websocket.close(code=1008, reason=f"Unauthorized: {str(e)}")
        return
    
    # Accept the WebSocket connection first
    await websocket.accept()
    logger.info("WebSocket connection accepted")
    
    db = next(get_db())
    try:
        # Debug logging
        logger.debug(f"Checking participant for user {user.id} (type: {type(user.id)}) in conversation {conversation_id} (type: {type(conversation_id)})")
        
        # Check if conversation exists
        conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not conversation:
            logger.warning(f"Conversation {conversation_id} not found in database")
            await websocket.close(code=1008, reason="Conversation not found")
            return
        
        logger.debug(f"Conversation found: {conversation.id}")
        
        # Check all participants in this conversation
        all_participants = db.query(ConversationParticipant)\
            .filter(ConversationParticipant.conversation_id == conversation_id)\
            .all()
        logger.info(f"Found {len(all_participants)} total participants in conversation {conversation_id}")
        for p in all_participants:
            logger.debug(f"  - Participant user_id: {p.user_id} (type: {type(p.user_id)}), matches: {p.user_id == user.id}")
        
        # Check specific participant
        participant = db.query(ConversationParticipant)\
            .filter(
                and_(
                    ConversationParticipant.conversation_id == conversation_id,
                    ConversationParticipant.user_id == user.id
                )
            ).first()

        if not participant:
            logger.error(f"User {user.id} is not a participant in conversation {conversation_id}")
            logger.error(f"  Available participants: {[str(p.user_id) for p in all_participants]}")
            logger.error(f"  Looking for user_id: {user.id} (type: {type(user.id)})")
            await websocket.close(code=1008, reason="Not a participant")
            return
        
        logger.info(f"Participant found, connecting user {user.id} to conversation {conversation_id}")
        
        await manager.connect(websocket, conversation_id, user.id)

        try:
            while True:
                data = await websocket.receive_json()

                if data["type"] == "send_message":
                    await handle_send_message(
                        websocket,
                        data,
                        user,
                        conversation_id,
                        db
                    )
                
                elif data["type"] == "typing":
                    typing_data = {
                        "type": "typing",
                        "user_id": str(user.id),
                        "conversation_id": str(conversation_id),
                        "is_typing": data.get("is_typing", True)
                    }
                    await manager.broadcast_to_conversation(
                        typing_data,
                        conversation_id,
                        exclude_websocket=websocket
                    )
                elif data["type"] == "read_receipt":
                    message_id = UUID(data.get("message_id"))

                    read_record = db.query(MessageRead)\
                        .filter(
                            and_(
                                MessageRead.message_id == message_id,
                                MessageRead.user_id == user.id
                            )
                        ).first()

                    if not read_record:
                        read_record = MessageRead(
                            message_id=message_id,
                            user_id=user.id
                        )
                        db.add(read_record)
                        db.commit()
                    
                    read_data = {
                        "type": "read", 
                        "message_id": str(message_id),
                        "reader_id": str(user.id),
                        "read_at": datetime.utcnow().isoformat()
                    }

                    await manager.broadcast_to_conversation(
                        read_data,
                        conversation_id,
                        exclude_websocket=websocket
                    )
        except WebSocketDisconnect:
            manager.disconnect(websocket, conversation_id)
        except Exception as e:
            logger.error(f"WebSocket error: {e}", exc_info=True)
            manager.disconnect(websocket, conversation_id)
    finally:
        db.close()



async def handle_send_message(
    websocket: WebSocket,
    data: dict,
    user: User,
    conversation_id: UUID,
    db: Session
):
    """Handle message sending via WebSocket with idempotency"""
    client_message_id = data.get("message_id")
    content = data.get("content")
    message_type = data.get("message_type", "text")
    reply_to = data.get("reply_to")
    message_metadata = data.get("message_metadata")

    if not client_message_id:
        await manager.send_personal_message({
            "type": "message_error",
            "error": "message_id required", 
            "status": "error"
        }, websocket)
        return

    if not content:
        await manager.send_personal_message({
            "type": "message_ack",
            "message_id": client_message_id,
            "status": "error",
            "error": "content required"
        }, websocket)
        return
    
    try:
        message_uuid = UUID(client_message_id)

        existing = db.query(Message).filter(Message.id == message_uuid).first()
        if existing:
            await manager.send_personal_message({
                "type": "message_ack",
                "message_id": client_message_id,
                "status": "success",
                "server_message_id": str(existing.id),
                "duplicated": True
            }, websocket)

            message_data = {
                "type": "new_message", 
                "conversation_id": str(conversation_id),
                "message": {
                    "id": str(existing.id),
                    "conversation_id": str(existing.conversation_id),
                    "sender_id": str(existing.sender_id),
                    "content": existing.content,
                    "message_type": existing.message_type,
                    "created_at": existing.created_at.isoformat(),
                    "updated_at": existing.updated_at.isoformat(),
                    "edited": existing.edited,
                    "reply_to": str(existing.reply_to) if existing.reply_to else None,
                    "message_metadata": existing.message_metadata,
                    "reactions": []
                }
            }

            await manager.broadcast_to_conversation(
                message_data,
                conversation_id,
                exclude_user_id=user.id
            )

            return
        
        reply_to_uuid = None
        if reply_to:
            try:
                reply_to_uuid = UUID(reply_to)
            except ValueError:
                pass

        # Create new message
        db_message = Message(
            id=message_uuid,  # Use client-provided ID for idempotency
            conversation_id=conversation_id,
            sender_id=user.id,
            content=content,
            message_type=message_type,
            reply_to=reply_to_uuid,
            message_metadata=message_metadata
        )

        db.add(db_message)

        # Update conversation timestamp
        db.query(Conversation)\
            .filter(Conversation.id == conversation_id)\
            .update({"updated_at": datetime.utcnow()})

        db.commit()
        db.refresh(db_message)

        # Get reactions (empty initially)
        reactions = []

        # Send acknowledgment IMMEDIATELY (critical for retry handling)
        await manager.send_personal_message({
            "type": "message_ack",
            "message_id": client_message_id,
            "status": "success",
            "server_message_id": str(db_message.id),
            "timestamp": db_message.created_at.isoformat()
        }, websocket)

        # Broadcast to other participants
        message_data = {
            "type": "new_message",
            "conversation_id": str(conversation_id),
            "message": {
                "id": str(db_message.id),
                "conversation_id": str(db_message.conversation_id),
                "sender_id": str(db_message.sender_id),
                "content": db_message.content,
                "message_type": db_message.message_type,
                "created_at": db_message.created_at.isoformat(),
                "updated_at": db_message.updated_at.isoformat(),
                "edited": db_message.edited,
                "reply_to": str(db_message.reply_to) if db_message.reply_to else None,
                "message_metadata": db_message.message_metadata,
                "reactions": reactions
            }
        }

        await manager.broadcast_to_conversation(
            message_data,
            conversation_id,
            exclude_user_id=user.id  # Don't send back to sender
        )

    except Exception as e:
        db.rollback()
        logger.error(f"Error processing message: {e}", exc_info=True)
        await manager.send_personal_message({
            "type": "message_ack",
            "message_id": client_message_id,
            "status": "error",
            "error": str(e)
        }, websocket)        


@app.post("/auth/login", response_model=Token)
async def login(user_credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_credentials.email).first()
    
    if not user or not verify_password(user_credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer"}


async def get_current_user(current_user: User = Depends(verify_token)):
    return current_user

@app.get("/users", response_model=UserResponse)
async def get_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user information by user_id. Requires authentication."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return user

@app.get("/users/search", response_model=UserResponse)
async def search_user_by_email(
    email: str = Query(..., description="Email address to search for"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search for a user by email address. Requires authentication."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return user

@app.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def create_user(request: Request, user: UserCreate, db: Session = Depends(get_db)):
    """
    Create a new user account (registration endpoint).
    """
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    hashed_password = get_password_hash(user.password)

    db_user = User(
        email=user.email,
        hashed_password=hashed_password
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    return db_user

@app.post("/conversations", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    participant_ids = set(conversation.participant_ids)
    if current_user.id not in participant_ids:
        participant_ids.add(current_user.id)

    db_conversation = Conversation(
        conversation_type=conversation.conversation_type,
        created_by=current_user.id
    )
    db.add(db_conversation)
    db.flush()

    logger.info(f"Created conversation {db_conversation.id} (type: {type(db_conversation.id)})")
    logger.debug(f"Current user ID: {current_user.id} (type: {type(current_user.id)})")
    logger.debug(f"Adding {len(participant_ids)} participants:")
    
    # Add participants
    for user_id in participant_ids:
        logger.debug(f"  - Adding participant: {user_id} (type: {type(user_id)})")
        participant = ConversationParticipant(
            conversation_id=db_conversation.id,
            user_id=user_id
        )
        db.add(participant)
    
    db.commit()
    db.refresh(db_conversation)
    
    # Verify participants were saved
    saved_participants = db.query(ConversationParticipant)\
        .filter(ConversationParticipant.conversation_id == db_conversation.id)\
        .all()
    logger.info(f"Saved {len(saved_participants)} participants to database:")
    for p in saved_participants:
        logger.debug(f"  - Saved participant user_id: {p.user_id} (type: {type(p.user_id)})")

    return ConversationResponse(
        id=db_conversation.id,
        conversation_type=db_conversation.conversation_type,
        created_by=db_conversation.created_by,
        created_at=db_conversation.created_at,
        updated_at=db_conversation.updated_at,
        participants=list(participant_ids)
    )

@app.get("/conversations", response_model=List[ConversationResponse])
async def get_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all conversations for current user"""
    conversations = db.query(Conversation)\
        .join(ConversationParticipant)\
        .filter(ConversationParticipant.user_id == current_user.id)\
        .order_by(desc(Conversation.updated_at))\
        .all()
    
    result = []
    for conv in conversations:
        participants = db.query(ConversationParticipant.user_id)\
            .filter(ConversationParticipant.conversation_id == conv.id)\
            .all()
        result.append(ConversationResponse(
            id=conv.id,
            conversation_type=conv.conversation_type,
            created_by=conv.created_by,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
            participants=[p[0] for p in participants]
        ))
    
    return result

@app.post("/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def create_message(
    message: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new message (persists to DB, then broadcasts via WebSocket)"""
    participant = db.query(ConversationParticipant)\
        .filter(
            and_(
                ConversationParticipant.conversation_id == message.conversation_id,
                ConversationParticipant.user_id == current_user.id
            )
        ).first()

    if not participant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a participant in this conversation"
        )
    
    db_message = Message(
        conversation_id=message.conversation_id,
        sender_id=current_user.id,
        content=message.content,
        message_type=message.message_type,
        reply_to=message.reply_to,
        message_metadata=message.message_metadata
    )

    db.add(db_message)

    db.query(Conversation)\
        .filter(Conversation.id == message.conversation_id)\
        .update({"updated_at": datetime.utcnow()})
    
    db.commit()
    db.refresh(db_message)

    reactions = []

    message_data = {
        "type": "new_message",
        "conversation_id": str(message.conversation_id),
        "message": {
            "id": str(db_message.id),
            "conversation_id": str(db_message.conversation_id),
            "sender_id": str(db_message.sender_id),
            "content": db_message.content,
            "message_type": db_message.message_type,
            "created_at": db_message.created_at.isoformat(),
            "updated_at": db_message.updated_at.isoformat(),
            "edited": db_message.edited,
            "reply_to": str(db_message.reply_to) if db_message.reply_to else None,
            "message_metadata": db_message.message_metadata,
            "reactions": reactions
        }
    }

    await manager.broadcast_to_conversation(
        message_data,
        message.conversation_id,
        exclude_user_id=current_user.id
    )

    return MessageResponse(
        id=db_message.id,
        conversation_id=db_message.conversation_id,
        sender_id=db_message.sender_id,
        content=db_message.content,
        message_type=db_message.message_type,
        created_at=db_message.created_at,
        updated_at=db_message.updated_at,
        edited=db_message.edited,
        reply_to=db_message.reply_to,
        message_metadata=db_message.message_metadata,
        reactions=reactions
    )

@app.get("/messages", response_model=MessageListResponse)
async def get_messages(
    conversation_id: UUID = Query(...),
    limit: int = Query(50, le=100, ge=1),
    before: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get messages for a conversation with pagination"""
    participant = db.query(ConversationParticipant)\
        .filter(
            and_(
                ConversationParticipant.conversation_id == conversation_id,
                ConversationParticipant.user_id == current_user.id
            )
        ).first()

    if not participant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a participant in this conversation"
        )

    query = db.query(Message)\
        .filter(
            and_(
                Message.conversation_id == conversation_id,
                Message.deleted_at.is_(None)
            )
        )

    if before:
        query = query.filter(Message.created_at < before)

    messages = query.order_by(desc(Message.created_at)).limit(limit + 1).all()

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:-1]
    
    messages.reverse()

    message_ids = [msg.id for msg in messages]
    reactions = db.query(MessageReaction)\
        .filter(MessageReaction.message_id.in_(message_ids))\
        .all()

    reactions_by_message = defaultdict(list)
    for reaction in reactions:
        reactions_by_message[reaction.message_id].append({
            "user_id": str(reaction.user_id),
            "emoji": reaction.emoji,
            "created_at": reaction.created_at.isoformat()
        })

    # Load read receipts
    read_receipts = db.query(MessageRead)\
        .filter(MessageRead.message_id.in_(message_ids))\
        .all()

    read_by_by_message = defaultdict(set)
    for read_receipt in read_receipts:
        read_by_by_message[read_receipt.message_id].add(str(read_receipt.user_id))

    message_responses = [
        MessageResponse(
            id=msg.id,
            conversation_id=msg.conversation_id,
            sender_id=msg.sender_id,
            content=msg.content,
            message_type=msg.message_type,
            created_at=msg.created_at,
            updated_at=msg.updated_at,
            edited=msg.edited,
            reply_to=msg.reply_to,
            message_metadata=msg.message_metadata,
            reactions=reactions_by_message.get(msg.id, []),
            read_by=list(read_by_by_message.get(msg.id, set()))
        )
        for msg in messages
    ]

    return MessageListResponse(
        messages=message_responses,
        has_more=has_more,
        next_cursor=messages[0].created_at if messages else None
    )
