import { useEffect, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getMessages, Message } from '@/services/api';
import { useConversationWebSocket } from '@/hooks/useWebSocket';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { isConnected, onMessage } = useConversationWebSocket(id || null);

  useEffect(() => {
    if (!id) {
      router.back();
      return;
    }

    loadMessages();

    // Listen for new messages via WebSocket
    const cleanup = onMessage('new_message', (data: any) => {
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
    });

    return cleanup;
  }, [id]);

  const loadMessages = async () => {
    if (!id) return;

    try {
      const response = await getMessages(id);
      setMessages(response.messages);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Conversation</Text>
        <Text style={styles.statusText}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>
      <View style={styles.content}>
        {loading ? (
          <Text style={styles.loadingText}>Loading messages...</Text>
        ) : messages.length === 0 ? (
          <Text style={styles.emptyText}>No messages yet</Text>
        ) : (
          <Text style={styles.messageCount}>
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </Text>
        )}
        <Text style={styles.placeholderText}>
          Chat UI implementation coming soon
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  statusText: {
    fontSize: 12,
    color: '#888888',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#888888',
    fontSize: 16,
    marginBottom: 16,
  },
  emptyText: {
    color: '#888888',
    fontSize: 16,
    marginBottom: 16,
  },
  messageCount: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 8,
  },
  placeholderText: {
    color: '#666666',
    fontSize: 14,
  },
});

