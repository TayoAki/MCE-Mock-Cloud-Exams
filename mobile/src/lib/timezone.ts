import { getCalendars } from 'expo-localization';

export function deviceTimezone(): string {
  try {
    return getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Etc/UTC';
  } catch {
    return 'Etc/UTC';
  }
}
