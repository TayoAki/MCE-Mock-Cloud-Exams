import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * EXPO_PUBLIC_API_URL wins. In development the app talks to Metro, which
 * proxies /v1 to the local API (metro.config.js), so web, simulators, phones on
 * the LAN, tunnels and GitHub Codespaces all work with nothing else exposed.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (__DEV__) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/v1`;
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) return `http://${hostUri}/v1`;
  }
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000/v1';
  return 'http://localhost:4000/v1';
}

export const API_URL = resolveApiUrl();
export const APP_VERSION = `mobile-${Constants.expoConfig?.version ?? '0.0.0'}`;
