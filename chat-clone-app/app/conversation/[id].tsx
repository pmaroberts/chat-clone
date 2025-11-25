import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Platform, StyleSheet, View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getMessages, Message } from '@/services/api';
import { useConversationWebSocket } from '@/hooks/useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto'


type OptimisticMessage = Message & {
  tempId?: string;
  status?: 'sending' | 'sent' | 'failed';
};

function decodeJwt(token: string | null): any | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload));
    return decoded;
  } catch (e) {
    return null;
  }
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<OptimisticMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [typingByUser, setTypingByUser] = useState<Record<string, number>>({});
  const [readByByMessageId, setReadByByMessageId] = useState<Record<string, Set<string>>>({});
  const sentReadReceiptForRef = useRef<Set<string>>(new Set());
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedTypingOffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { isConnected, onMessage, sendMessage, sendTyping, sendReadReceipt } = useConversationWebSocket(id || null);

  // Decode user id from token (best-effort)
  useEffect(() => {
    (async () => {
      const token = await AsyncStorage.getItem('authToken');
      const payload = decodeJwt(token);
      const userId = payload?.sub || payload?.user_id || null;
      setCurrentUserId(userId);
    })();
  }, []);

  useEffect(() => {
    if (!id) {
      router.back();
      return;
    }

    loadInitialMessages();

    // new_message handler
    const offNew = onMessage('new_message', (data: any) => {
      const serverMsg: Message | undefined = data?.message;
      if (!serverMsg) return;

      setMessages((prev) => {
        // Try to dedupe optimistic message from self by content & recent time window
        const tenSecondsAgo = Date.now() - 10_000;
        const idx = prev.findIndex((m) =>
          m.sender_id === currentUserId &&
          m.content === serverMsg.content &&
          (new Date(m.created_at).getTime() >= tenSecondsAgo || !!m.tempId)
        );
        if (idx !== -1) {
          const copy = [...prev];
          copy[idx] = { ...serverMsg };
          return copy;
        }
        // Prepend newest message to keep array in descending order
        return [serverMsg, ...prev];
      });
    });

    // typing handler
    const offTyping = onMessage('typing', (data: any) => {
      const { user_id, is_typing } = data || {};
      if (!user_id || user_id === currentUserId) return;
      setTypingByUser((prev) => ({ ...prev, [user_id]: is_typing ? Date.now() : 0 }));
      // Auto-clear typing after 4s
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setTypingByUser((prev) => {
          const next: Record<string, number> = { ...prev };
          Object.keys(next).forEach((uid) => {
            if (Date.now() - (next[uid] || 0) > 4000) delete next[uid];
          });
          return next;
        });
      }, 4000);
    });

    // read receipt handler
    const offRead = onMessage('read', (data: any) => {
      const { message_id, reader_id } = data || {};
      if (!message_id || !reader_id) return;
      setReadByByMessageId((prev) => {
        const set = new Set(prev[message_id] || []);
        set.add(reader_id);
        return { ...prev, [message_id]: set };
      });
    });

    return () => {
      offNew?.();
      offTyping?.();
      offRead?.();
    };
  }, [id, currentUserId, onMessage, router]);

  const sortDesc = (list: Message[]) =>
    [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const loadInitialMessages = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await getMessages(id, 50);
      const sorted = sortDesc(response.messages);
      setMessages(sorted);

      const initialReadBy: Record<string, Set<string>> = {};
      sorted.forEach((msg: any) => {
        if (msg.read_by && Array.isArray(msg.read_by)) {
          initialReadBy[msg.id] = new Set(msg.read_by);
        }
      });
      setReadByByMessageId(initialReadBy);

      setHasMore(!!response.has_more);
      setNextCursor(response.next_cursor);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!id || !hasMore || !nextCursor || loading) return;
    try {
      const response = await getMessages(id, 50, nextCursor);
      const sorted = sortDesc(response.messages);
      setMessages((prev) => [...prev, ...sorted]);
      setHasMore(!!response.has_more);
      setNextCursor(response.next_cursor);
    } catch (error) {
      console.error('Error loading more messages:', error);
    }
  };

  const handleSend = async () => {
    if (!id || !inputText.trim() || !currentUserId) return;
    const content = inputText.trim();
    const tempId = await Crypto.randomUUID();
    const optimistic: OptimisticMessage = {
      id: tempId,
      tempId,
      conversation_id: id,
      sender_id: currentUserId,
      content,
      message_type: 'text',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      edited: false,
      reactions: [],
      status: 'sending'
    } as OptimisticMessage;

    // Prepend optimistic message to keep array in descending order
    setMessages((prev) => [optimistic, ...prev]);
    setInputText('');
    setSending(true);
    try {
      await sendMessage(content, 'text');
      // Mark optimistic as sent; server message should replace via new_message
      setMessages((prev) => prev.map((m) => (m.tempId === tempId ? { ...m, status: 'sent' } : m)));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.tempId === tempId ? { ...m, status: 'failed' } : m)));
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: any) => {
    if (e.nativeEvent.key === 'Enter' && e.nativeEvent.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Typing: debounce on input changes
  useEffect(() => {
    if (!id) return;
    if (debouncedTypingOffRef.current) clearTimeout(debouncedTypingOffRef.current);
    if (inputText.length > 0) {
      sendTyping(true);
      debouncedTypingOffRef.current = setTimeout(() => sendTyping(false), 1500);
    } else {
      sendTyping(false);
    }
  }, [id, inputText, sendTyping]);

  const viewabilityConfig = useMemo(() => ({
    itemVisiblePercentThreshold: 60
  }), []);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    console.log(currentUserId)
    if (!currentUserId) return;
    // Send read receipts for visible messages from others
    viewableItems.forEach((vi: any) => {
      const msg: OptimisticMessage | undefined = vi?.item;
      if (!msg || !msg.id) return;
      const isFromOther = msg.sender_id && msg.sender_id !== currentUserId;
      if (!isFromOther) return;
      if (!sentReadReceiptForRef.current.has(msg.id)) {
        console.log("sending read receipt")
        sendReadReceipt(msg.id);
        sentReadReceiptForRef.current.add(msg.id);
      }
    });
  }).current;

  const typingDisplay = useMemo(() => {
    const users = Object.keys(typingByUser || {});
    if (users.length === 0) return '';
    return users.length === 1 ? 'Someone is typing…' : 'Multiple people are typing…';
  }, [typingByUser]);

  const renderItem = useCallback(({ item }: { item: OptimisticMessage }) => {
    const isSelf = currentUserId && item.sender_id === currentUserId;
    const readSet = readByByMessageId[item.id];
    const readCount = readSet ? readSet.size : 0;
    return (
      <View style={[styles.bubbleContainer, isSelf ? styles.bubbleRight : styles.bubbleLeft]}>
        <View style={[styles.bubble, isSelf ? styles.bubbleSelf : styles.bubbleOther]}>
          <Text style={styles.messageText}>{item.content}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.timeText}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            {isSelf ? (
              <Text style={styles.statusTextSmall}>
                {item.status === 'failed' ? '(!)' : item.status === 'sending' ? '…' : readCount > 0 ? '✓✓' : '✓'}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  }, [currentUserId, readByByMessageId]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Conversation</Text>
        <Text style={styles.statusText}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>
      <View style={styles.content}>
        {loading && messages.length === 0 ? (
          <ActivityIndicator color="#888888" />
        ) : (
          <FlatList
            data={messages}
            inverted
            keyExtractor={(item) => item.id || item.tempId || Crypto.randomUUID()}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onEndReachedThreshold={0.1}
            onEndReached={loadMore}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            ListEmptyComponent={!loading ? (
              <Text style={styles.emptyText}>No messages yet</Text>
            ) : null}
          />
        )}
        {typingDisplay ? (
          <Text style={styles.typingText}>{typingDisplay}</Text>
        ) : null}
      </View>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          placeholderTextColor="#666"
          multiline
          value={inputText}
          onChangeText={setInputText}
          onKeyPress={handleKeyPress}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
        >
          <Text style={styles.sendButtonText}>{sending ? '...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyText: {
    color: '#888888',
    fontSize: 16,
    marginBottom: 16,
  },
  listContent: {
    paddingVertical: 8,
  },
  typingText: {
    color: '#888888',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 4,
  },
  bubbleContainer: {
    width: '100%',
    marginVertical: 4,
    flexDirection: 'row',
  },
  bubbleLeft: {
    justifyContent: 'flex-start',
  },
  bubbleRight: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  bubbleSelf: {
    backgroundColor: '#0a84ff',
  },
  bubbleOther: {
    backgroundColor: '#1f1f1f',
  },
  messageText: {
    color: '#ffffff',
    fontSize: 16,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: '#cccccc',
    fontSize: 10,
  },
  statusTextSmall: {
    color: '#e6e6e6',
    fontSize: 10,
    marginLeft: 8,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 8,
  },
  sendButton: {
    backgroundColor: '#0a84ff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#2f60a3',
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});

