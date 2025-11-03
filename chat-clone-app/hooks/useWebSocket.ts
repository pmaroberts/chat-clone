import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketManager } from '@/services/websocket';

export function useConversationWebSocket(conversationId: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const wsManagerRef = useRef<WebSocketManager | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    const manager = new WebSocketManager(
      () => setIsConnected(true),
      () => setIsConnected(false),
      (err) => setError(err)
    );

    wsManagerRef.current = manager;

    // Connect
    manager.connect(conversationId).catch((err) => {
      setError(err);
      setIsConnected(false);
    });

    // Cleanup
    return () => {
      manager.disconnect();
      wsManagerRef.current = null;
    };
  }, [conversationId]);

  const sendMessage = useCallback(async (
    content: string,
    messageType: string = 'text',
    replyTo?: string,
    metadata?: any
  ): Promise<string> => {
    if (!wsManagerRef.current || !conversationId) {
      throw new Error('WebSocket not connected');
    }

    return wsManagerRef.current.sendMessage(content, conversationId, messageType, replyTo, metadata);
  }, [conversationId]);

  const sendTyping = useCallback((isTyping: boolean) => {
    wsManagerRef.current?.sendTyping(isTyping);
  }, []);

  const sendReadReceipt = useCallback((messageId: string) => {
    wsManagerRef.current?.sendReadReceipt(messageId);
  }, []);

  const onMessage = useCallback((type: string, handler: (data: any) => void) => {
    wsManagerRef.current?.on(type, handler);
    return () => {
      wsManagerRef.current?.off(type);
    };
  }, []);

  return {
    isConnected,
    error,
    sendMessage,
    sendTyping,
    sendReadReceipt,
    onMessage,
    wsManager: wsManagerRef.current
  };
}

