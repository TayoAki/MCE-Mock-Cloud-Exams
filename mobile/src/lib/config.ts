import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * EXPO_PUBLIC_API_URL wins. Otherwise use the Metro host's address so a
 * simulator or a device on the same network reaches the local API on :4000.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (Platform.OS === 'web') return 'http://localhost:4000/v1';
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000/v1`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000/v1' : 'http://localhost:4000/v1';
}

export const API_URL = resolveApiUrl();
export const APP_VERSION = `mobile-${Constants.expoConfig?.version ?? '0.0.0'}`;
