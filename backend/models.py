from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from database import Base
from datetime import datetime
import uuid


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    conversation_type = Column(String(20), nullable=False)  # 'direct', 'group', 'channel'
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"
    
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    __table_args__ = (
        Index('ix_conversation_participants_user_id', 'user_id'),
    )


class Message(Base):
    __tablename__ = "messages"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False, index=True)
    sender_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="text")  # 'text', 'image', 'file', 'system'
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    edited = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)  # Soft delete
    reply_to = Column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True)
    message_metadata = Column(JSONB, nullable=True)  # For attachments, mentions, custom data
    
    __table_args__ = (
        Index('ix_messages_conversation_created', 'conversation_id', 'created_at'),
    )


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    emoji = Column(String(10), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('message_id', 'user_id', 'emoji', name='unique_reaction'),
        Index('ix_message_reactions_message_id', 'message_id'),
    )


class MessageRead(Base):
    __tablename__ = "message_reads"
    
    message_id = Column(UUID(as_uuid=True), ForeignKey("messages.id"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    read_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    __table_args__ = (
        Index('ix_message_reads_user_id', 'user_id'),
    )