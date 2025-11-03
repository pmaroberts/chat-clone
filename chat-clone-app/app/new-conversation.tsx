import { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getUserByEmail, createConversation, User } from '@/services/api';

export default function NewConversationScreen() {
  const [email, setEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const handleSearch = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return;
    }

    setSearching(true);
    setFoundUser(null);

    try {
      const user = await getUserByEmail(email.trim());
      setFoundUser(user);
    } catch (error: any) {
      if (error.response?.status === 404) {
        Alert.alert('User Not Found', `No user found with email: ${email}`);
      } else {
        Alert.alert('Error', error.message || 'Failed to search for user');
      }
      setFoundUser(null);
    } finally {
      setSearching(false);
    }
  };

  const handleCreateConversation = async () => {
    if (!foundUser) {
      Alert.alert('Error', 'Please search for a user first');
      return;
    }

    setCreating(true);

    try {
      const conversation = await createConversation([foundUser.email]);
      
      // Navigate to the conversation chat screen
      router.replace(`/conversation/${conversation.id}`);
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.message || 'Failed to create conversation'
      );
    } finally {
      setCreating(false);
    }
  };

  const handleClear = () => {
    setEmail('');
    setFoundUser(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>New Conversation</Text>
          <Text style={styles.subtitle}>
            Enter an email address to start a conversation
          </Text>
        </View>

        <View style={styles.searchSection}>
          <TextInput
            style={styles.input}
            placeholder="Enter email address"
            placeholderTextColor="#666666"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!searching && !creating}
          />

          <View style={styles.buttonRow}>
            {email.trim() && (
              <TouchableOpacity
                style={[styles.button, styles.clearButton]}
                onPress={handleClear}
                disabled={searching || creating}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.button, styles.searchButton]}
              onPress={handleSearch}
              disabled={searching || creating || !email.trim()}
            >
              {searching ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.searchButtonText}>Search</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {foundUser && (
          <View style={styles.userCard}>
            <View style={styles.userInfo}>
              <View style={styles.userIcon}>
                <Text style={styles.userIconText}>
                  {foundUser.email.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.userDetails}>
                <Text style={styles.userEmail}>{foundUser.email}</Text>
                <Text style={styles.userMeta}>
                  User ID: {foundUser.id.substring(0, 8)}...
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.button, styles.createButton]}
              onPress={handleCreateConversation}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.createButtonText}>Start Conversation</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  header: {
    marginBottom: 32,
    marginTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888888',
  },
  searchSection: {
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#333333',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButton: {
    backgroundColor: '#8b5cf6',
  },
  searchButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  clearButton: {
    backgroundColor: '#333333',
  },
  clearButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  userCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333333',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  userIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#8b5cf6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  userIconText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  userDetails: {
    flex: 1,
  },
  userEmail: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  userMeta: {
    fontSize: 12,
    color: '#888888',
  },
  createButton: {
    backgroundColor: '#8b5cf6',
    width: '100%',
  },
  createButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

