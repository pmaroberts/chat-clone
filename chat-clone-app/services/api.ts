import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { invokeExternalLogout } from '@/contexts/AuthContext';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
})

// Add token to requests if available
api.interceptors.request.use(
    async (config) => {
        const token = await AsyncStorage.getItem('authToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Global 401 handler: clear token and redirect to login
let isHandlingAuthError = false;

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const status = error?.response?.status;
        const url: string = error?.config?.url || '';

        const isAuthEndpoint = url.startsWith('/auth/');

        if (status === 401 && !isHandlingAuthError && !isAuthEndpoint) {
            isHandlingAuthError = true;
            try {
                await AsyncStorage.removeItem('authToken');
                if (typeof invokeExternalLogout === 'function') {
                    await invokeExternalLogout();
                }
            } catch {}
            finally {
                try {
                    router.replace('/login');
                } catch {}
                setTimeout(() => { isHandlingAuthError = false; }, 500);
            }
        }

        return Promise.reject(error);
    }
);

// API Methods

export interface Conversation {
  id: string;
  conversation_type: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  participants: string[];
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  created_at: string;
  updated_at: string;
  edited: boolean;
  reply_to?: string;
  message_metadata?: any;
  reactions: any[];
}

export interface MessageListResponse {
  messages: Message[];
  has_more: boolean;
  next_cursor?: string;
}

export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

// Get all conversations for current user
export const getConversations = async (): Promise<Conversation[]> => {
  const response = await api.get<Conversation[]>('/conversations');
  return response.data;
};

// Create a new conversation
export const createConversation = async (
  participantEmails: string[]
): Promise<Conversation> => {
  // First, get user IDs for the emails
  const participantIds: string[] = [];
  
  for (const email of participantEmails) {
    try {
      const user = await getUserByEmail(email);
      participantIds.push(user.id);
    } catch (error) {
      throw new Error(`User with email ${email} not found`);
    }
  }

  const response = await api.post<Conversation>('/conversations', {
    conversation_type: 'direct',
    participant_ids: participantIds
  });
  
  return response.data;
};

// Get messages for a conversation
export const getMessages = async (
  conversationId: string,
  limit: number = 50,
  before?: string
): Promise<MessageListResponse> => {
  const params: any = {
    conversation_id: conversationId,
    limit
  };
  
  if (before) {
    params.before = before;
  }

  const response = await api.get<MessageListResponse>('/messages', { params });
  return response.data;
};

// Get user by email
export const getUserByEmail = async (email: string): Promise<User> => {
  const response = await api.get<User>('/users/search', {
    params: { email }
  });
  return response.data;
};

