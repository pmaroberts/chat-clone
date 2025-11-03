from pydantic import BaseModel, EmailStr
from datetime import datetime
from uuid import UUID
from typing import Optional, List, Dict, Any

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: UUID
    email: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
class ConversationCreate(BaseModel):
    conversation_type: str  # 'direct', 'group', 'channel'
    participant_ids: List[UUID]

class ConversationResponse(BaseModel):
    id: UUID
    conversation_type: str
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    participants: List[UUID] = []
    
    class Config:
        from_attributes = True

class MessageCreate(BaseModel):
    conversation_id: UUID
    content: str
    message_type: str = "text"
    reply_to: Optional[UUID] = None
    message_metadata: Optional[Dict[str, Any]] = None

class MessageReactionCreate(BaseModel):
    message_id: UUID
    emoji: str

class MessageResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    sender_id: UUID
    content: str
    message_type: str
    created_at: datetime
    updated_at: datetime
    edited: bool
    reply_to: Optional[UUID] = None
    message_metadata: Optional[Dict[str, Any]] = None
    reactions: List[Dict[str, Any]] = []  # Will be populated via join
    
    class Config:
        from_attributes = True

class MessageListResponse(BaseModel):
    messages: List[MessageResponse]
    has_more: bool
    next_cursor: Optional[datetime] = None
