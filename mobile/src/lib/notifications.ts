import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { patch, post } from './api';

/**
 * Reminders are off until the learner opts in after receiving value. Denying
 * permission leaves the app fully usable; the preference just stays off.
 */
export async function enableReminders(localTime = '21:00'): Promise<'enabled' | 'denied' | 'unavailable'> {
  if (Platform.OS === 'web') {
    await patch('/me/preferences', { reminders_enabled: true, daily_local_time: localTime });
    return 'unavailable';
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return 'denied';
  await patch('/me/preferences', { reminders_enabled: true, daily_local_time: localTime });
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await post('/me/push-tokens', { token: token.data, platform: Platform.OS });
  } catch {
    // Push tokens need an EAS project ID and a development build; the preference is still saved.
  }
  return 'enabled';
}
