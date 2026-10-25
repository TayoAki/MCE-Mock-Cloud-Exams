import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * EXPO_PUBLIC_API_URL wins. On web the app calls /v1 on its own origin: Metro
 * proxies it to the local API in development (metro.config.js), and the hosted
 * web app's server proxies it in production (Caddyfile). In development native
 * apps talk to Metro the same way, so simulators, phones on the LAN, tunnels and
 * GitHub Codespaces all work with nothing else exposed.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/v1`;
  if (__DEV__) {
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) return `http://${hostUri}/v1`;
  }
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000/v1';
  return 'http://localhost:4000/v1';
}

export const API_URL = resolveApiUrl();
export const APP_VERSION = `mobile-${Constants.expoConfig?.version ?? '0.0.0'}`;
