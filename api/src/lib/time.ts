import { DateTime, IANAZone } from 'luxon';

export const isValidZone = (zone: string) => IANAZone.isValidZone(zone);

/** The learner's calendar date for an instant, as YYYY-MM-DD. */
export function localDate(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toISODate()!;
}

/** The UTC instant at which a local calendar date begins in a zone (handles DST gaps). */
export function startOfLocalDay(date: string, zone: string): Date {
  return DateTime.fromISO(date, { zone }).startOf('day').toJSDate();
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

export function daysBetween(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: 'utc' });
  const b = DateTime.fromISO(to, { zone: 'utc' });
  return Math.round(b.diff(a, 'days').days);
}

/** Monday-based week containing an instant, in the given zone. */
export function localWeek(instant: Date, zone: string) {
  const start = DateTime.fromJSDate(instant, { zone }).startOf('week');
  return { startsAt: start.toJSDate(), endsAt: start.plus({ weeks: 1 }).toJSDate(), startDate: start.toISODate()! };
}

/**
 * The instant a wall-clock time occurs on a local date. Nonexistent times (DST
 * spring-forward) move to the next valid local time; Luxon shifts them forward.
 */
export function localTimeOn(date: string, hhmm: string, zone: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return DateTime.fromISO(date, { zone }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** True when a local HH:mm falls inside a quiet window; windows may cross midnight. */
export function inQuietHours(hhmm: string, quietStart: string, quietEnd: string): boolean {
  const t = minutesOf(hhmm);
  const s = minutesOf(quietStart);
  const e = minutesOf(quietEnd);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

export interface TimezoneFields {
  timezone: string;
  pendingTimezone?: { zone: string; effectiveAt: Date } | null;
}

/** Timezone changes apply prospectively from the next local-day boundary. */
export function effectiveTimezone(user: TimezoneFields, now = new Date()): string {
  const pending = user.pendingTimezone;
  if (pending?.zone && pending.effectiveAt && pending.effectiveAt.getTime() <= now.getTime()) return pending.zone;
  return user.timezone;
}

export function nextLocalMidnight(now: Date, zone: string): Date {
  return DateTime.fromJSDate(now, { zone }).plus({ days: 1 }).startOf('day').toJSDate();
}
