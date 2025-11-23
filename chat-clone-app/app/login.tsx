import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/services/api';

interface PasswordRequirements {
  minLength: boolean;
  hasUppercase: boolean;
  hasSpecialChar: boolean;
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSignupMode, setIsSignupMode] = useState(false);
  
  const router = useRouter();
  const { login } = useAuth();
  const passwordInputRef = useRef<TextInput>(null);

  const validatePassword = (pwd: string): PasswordRequirements => {
    return {
      minLength: pwd.length >= 8,
      hasUppercase: /[A-Z]/.test(pwd),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
    };
  };

  const passwordRequirements = validatePassword(password);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }

    if (isSignupMode) {
      const requirements = validatePassword(password);
      if (!requirements.minLength || !requirements.hasUppercase || !requirements.hasSpecialChar) {
        setError('Password does not meet all requirements');
        return;
      }
    }

    setError('');
    setLoading(true);

    try {
      if (isSignupMode) {
        // Handle signup
        await api.post('/users', {
          email: email.trim(),
          password: password,
        });

        // After successful signup, auto-login
        try {
          const loginResponse = await api.post('/auth/login', {
            email: email.trim(),
            password: password,
          });
          await login(loginResponse.data.access_token);
          router.replace('/(tabs)');
        } catch (loginErr) {
          // If auto-login fails, navigate to login page
          router.replace('/login');
        }
      } else {
        // Handle login
        const response = await api.post('/auth/login', {
          email: email.trim(),
          password: password,
        });

        await login(response.data.access_token);
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      setError(
        err.response?.data?.detail || 
        (isSignupMode ? 'Signup failed. Please try again.' : 'Login failed. Please check your credentials.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          {/* Title */}
          <Text style={styles.title}>{isSignupMode ? 'Sign up' : 'Sign in'}</Text>

          {/* Email Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={20} color="#fff" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#666"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => {
                  passwordInputRef.current?.focus();
                }}
              />
            </View>
          </View>

          {/* Password Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={20} color="#fff" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder={isSignupMode ? 'Create a password' : 'Enter your password'}
                placeholderTextColor="#666"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setError('');
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
              >
                <Ionicons
                  name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Password Requirements (only in signup mode) */}
          {isSignupMode && password.length > 0 && (
            <View style={styles.requirementsContainer}>
              <View style={styles.requirementItem}>
                <Ionicons
                  name={passwordRequirements.minLength ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={passwordRequirements.minLength ? '#4ade80' : '#ef4444'}
                />
                <Text
                  style={[
                    styles.requirementText,
                    passwordRequirements.minLength && styles.requirementTextMet,
                  ]}
                >
                  At least 8 characters
                </Text>
              </View>
              <View style={styles.requirementItem}>
                <Ionicons
                  name={passwordRequirements.hasUppercase ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={passwordRequirements.hasUppercase ? '#4ade80' : '#ef4444'}
                />
                <Text
                  style={[
                    styles.requirementText,
                    passwordRequirements.hasUppercase && styles.requirementTextMet,
                  ]}
                >
                  One uppercase letter
                </Text>
              </View>
              <View style={styles.requirementItem}>
                <Ionicons
                  name={passwordRequirements.hasSpecialChar ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={passwordRequirements.hasSpecialChar ? '#4ade80' : '#ef4444'}
                />
                <Text
                  style={[
                    styles.requirementText,
                    passwordRequirements.hasSpecialChar && styles.requirementTextMet,
                  ]}
                >
                  One special character
                </Text>
              </View>
            </View>
          )}

          {/* Error Message */}
          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Forgot Password (only in login mode) */}
          {!isSignupMode && (
            <TouchableOpacity style={styles.forgotPasswordContainer}>
              <Ionicons name="key-outline" size={16} color="#fff" />
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}

          {/* Action Buttons */}
          <View style={styles.actionContainer}>
            <TouchableOpacity
              onPress={() => {
                setIsSignupMode(!isSignupMode);
                setError('');
              }}
              style={styles.toggleButtonWrapper}
            >
              <View style={styles.toggleButton}>
                <Text style={styles.toggleButtonText}>
                  {isSignupMode ? 'Sign in' : 'Sign up'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              style={styles.loginButtonWrapper}
            >
              <LinearGradient
                colors={['#22c55e', '#22c55e']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginButton}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.loginButtonText}>{isSignupMode ? 'Sign Up' : 'Login'}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  } as any,
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  eyeIcon: {
    padding: 4,
  },
  requirementsContainer: {
    marginTop: 12,
    marginBottom: 8,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  requirementText: {
    color: '#ef4444',
    fontSize: 14,
    marginLeft: 8,
  },
  requirementTextMet: {
    color: '#4ade80',
  },
  errorContainer: {
    marginTop: 8,
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#3a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 14,
  },
  forgotPasswordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 6,
  },
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  toggleButtonWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  toggleButton: {
    backgroundColor: '#4a4a4a',
    paddingHorizontal: 32,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  toggleButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loginButtonWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  loginButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

