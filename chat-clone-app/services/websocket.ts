import { v4 as uuidv4 } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:8000';

interface PendingMessage {
  id: string;
  content: string;
  conversationId: string;
  timestamp: number;
  retries: number;
  resolve: (messageId: string) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private conversationId: string | null = null;
  private token: string | null = null;
  private pendingMessages: Map<string, PendingMessage> = new Map();
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private ackTimeout = 5000; // 5 seconds to wait for ack
  private maxRetries = 3;
  private retryDelays = [500, 1000, 2000]; // Exponential backoff

  constructor(
    private onConnect?: () => void,
    private onDisconnect?: () => void,
    private onError?: (error: Error) => void
  ) {}

  async connect(conversationId: string): Promise<void> {
    this.conversationId = conversationId;
    
    // Get token from storage
    this.token = await AsyncStorage.getItem('authToken');
    
    if (!this.token) {
      throw new Error('No authentication token found');
    }

    return this._connect();
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.conversationId || !this.token) {
        reject(new Error('Conversation ID or token missing'));
        return;
      }

      const wsUrl = `${WS_BASE_URL}/ws/conversations/${this.conversationId}?token=${this.token}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.onConnect?.();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.onError?.(new Error('WebSocket connection error'));
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.onDisconnect?.();
        this.attemptReconnect();
      };
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    setTimeout(() => {
      console.log(`Reconnecting (attempt ${this.reconnectAttempts})...`);
      this._connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  sendMessage(
    content: string,
    conversationId: string,
    messageType: string = 'text',
    replyTo?: string,
    metadata?: any
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const messageId = uuidv4();
      const idempotencyKey = `${messageId}-${Date.now()}`;

      const pendingMsg: PendingMessage = {
        id: messageId,
        content,
        conversationId,
        timestamp: Date.now(),
        retries: 0,
        resolve,
        reject
      };

      this.pendingMessages.set(messageId, pendingMsg);
      this.attemptSendMessage(pendingMsg, messageType, replyTo, metadata, idempotencyKey);
    });
  }

  private attemptSendMessage(
    message: PendingMessage,
    messageType: string,
    replyTo?: string,
    metadata?: any,
    idempotencyKey?: string,
    attempt: number = 0
  ): void {
    if (attempt >= this.maxRetries) {
      // Max retries exceeded - reject and clean up
      message.reject(new Error('Failed to send message after maximum retries'));
      this.pendingMessages.delete(message.id);
      return;
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      // WebSocket not connected - retry after delay
      const delay = this.retryDelays[attempt] || this.retryDelays[this.retryDelays.length - 1];
      setTimeout(() => {
        if (this.pendingMessages.has(message.id)) {
          this.attemptSendMessage(message, messageType, replyTo, metadata, idempotencyKey, attempt + 1);
        }
      }, delay);
      return;
    }

    // Send message
    try {
      this.ws.send(JSON.stringify({
        type: 'send_message',
        message_id: message.id,
        idempotency_key: idempotencyKey || `${message.id}-${Date.now()}`,
        content: message.content,
        conversation_id: message.conversationId,
        message_type: messageType,
        reply_to: replyTo,
        message_metadata: metadata
      }));

      // Set timeout for acknowledgment
      const timeoutId = setTimeout(() => {
        if (this.pendingMessages.has(message.id)) {
          console.warn(`No ack received for message ${message.id}, retrying...`);
          // Retry
          this.attemptSendMessage(message, messageType, replyTo, metadata, idempotencyKey, attempt + 1);
        }
      }, this.ackTimeout);

      // Store timeout ID to clear if ack received
      message.timeoutId = timeoutId;
    } catch (error) {
      console.error('Error sending message:', error);
      // Retry after delay
      const delay = this.retryDelays[attempt] || this.retryDelays[this.retryDelays.length - 1];
      setTimeout(() => {
        if (this.pendingMessages.has(message.id)) {
          this.attemptSendMessage(message, messageType, replyTo, metadata, idempotencyKey, attempt + 1);
        }
      }, delay);
    }
  }

  private handleMessage(data: WebSocketMessage): void {
    const { type } = data;

    // Handle message acknowledgments
    if (type === 'message_ack') {
      const messageId = data.message_id;
      const pendingMsg = this.pendingMessages.get(messageId);

      if (pendingMsg) {
        // Clear timeout
        if (pendingMsg.timeoutId) {
          clearTimeout(pendingMsg.timeoutId);
        }

        if (data.status === 'success') {
          pendingMsg.resolve(messageId);
        } else {
          pendingMsg.reject(new Error(data.error || 'Message send failed'));
        }

        this.pendingMessages.delete(messageId);
      }
      return;
    }

    // Handle other message types via registered handlers
    const handler = this.messageHandlers.get(type);
    if (handler) {
      handler(data);
    }

    // Fallback: trigger event for common types
    if (type === 'new_message' || type === 'typing' || type === 'presence' || type === 'read') {
      // These will be handled by registered handlers
    }
  }

  // Register handlers for incoming messages
  on(type: string, handler: (data: any) => void): void {
    this.messageHandlers.set(type, handler);
  }

  // Unregister handlers
  off(type: string): void {
    this.messageHandlers.delete(type);
  }

  // Send typing indicator
  sendTyping(isTyping: boolean): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'typing',
        is_typing: isTyping
      }));
    }
  }

  // Send read receipt
  sendReadReceipt(messageId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'read_receipt',
        message_id: messageId
      }));
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingMessages.clear();
    this.messageHandlers.clear();
  }
}

