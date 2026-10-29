import { patch } from './api';

/** Web preview: no push delivery, so there is nothing to route. */
export function useNotificationRouting() {}

/** Web preview: no push delivery, so only the preference is saved. */
export async function enableReminders(localTime = '21:00'): Promise<'enabled' | 'denied' | 'unavailable'> {
  await patch('/me/preferences', { reminders_enabled: true, daily_local_time: localTime });
  return 'unavailable';
}
