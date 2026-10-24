import { config } from '../config.js';
import { DailyStudyDay, Enrollment, NotificationJob, NotificationPreference, PushToken, User } from '../models/index.js';
import { track } from '../lib/analytics.js';
import { effectiveTimezone, inQuietHours, localDate, localTimeOn } from '../lib/time.js';

const DAILY_COPY = { title: 'A little practice today?', body: 'Your next five questions are ready when you are.' };

async function eligibility(userId: string, studyDate: string): Promise<string | null> {
  const [user, prefs, studied, activeEnrollment] = await Promise.all([
    User.findById(userId).select({ deletedAt: 1, deletionRequestedAt: 1 }).lean(),
    NotificationPreference.findById(userId).lean(),
    DailyStudyDay.exists({ userId, studyDate }),
    Enrollment.exists({ userId, status: 'active' }),
  ]);
  if (!user || user.deletedAt || user.deletionRequestedAt) return 'deleted';
  if (!prefs?.remindersEnabled) return 'opted_out';
  if (studied) return 'studied';
  if (!activeEnrollment) return 'no_active_enrollment';
  return null;
}

/**
 * Queues at most one daily reminder per learner-local date, at the chosen time,
 * moved to the end of quiet hours when needed. The unique dedupe key prevents repeats.
 */
export async function planReminders(now = new Date()) {
  const prefs = await NotificationPreference.find({ remindersEnabled: true }).lean();
  let planned = 0;
  for (const p of prefs) {
    const user = await User.findById(p._id).select({ timezone: 1, pendingTimezone: 1, deletedAt: 1 }).lean();
    if (!user || user.deletedAt) continue;
    const zone = effectiveTimezone(user, now);
    const studyDate = localDate(now, zone);
    if (await eligibility(p._id, studyDate)) continue;
    const desired = p.dailyLocalTime ?? '21:00';
    const time = inQuietHours(desired, p.quietStart ?? '23:00', p.quietEnd ?? '08:00') ? (p.quietEnd ?? '08:00') : desired;
    const scheduledAt = localTimeOn(studyDate, time, zone);
    if (scheduledAt <= now) continue;
    const res = await NotificationJob.updateOne(
      { dedupeKey: `daily_goal:${p._id}:${studyDate}` },
      { $setOnInsert: { userId: p._id, kind: 'daily_goal', studyDate, scheduledAt, status: 'queued' } },
      { upsert: true },
    );
    planned += res.upsertedCount;
  }
  return planned;
}

async function sendExpoPush(tokens: string[]): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!config.EXPO_PUSH_ENABLED) return { ok: false, error: 'push_disabled' };
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, ...DAILY_COPY, data: { route: '/learn' } }))),
    });
    if (!res.ok) return { ok: false, error: `status_${res.status}` };
    const body = (await res.json()) as { data?: { id?: string; status?: string }[] };
    const first = body.data?.find((d) => d.status === 'ok');
    return first ? { ok: true, id: first.id } : { ok: false, error: 'rejected' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Rechecks eligibility immediately before each send. Device tokens are never logged. */
export async function dispatchReminders(now = new Date()) {
  const due = await NotificationJob.find({ status: 'queued', scheduledAt: { $lte: now } }).limit(200).lean();
  for (const job of due) {
    const reason = await eligibility(job.userId, job.studyDate);
    if (reason) {
      await NotificationJob.updateOne({ _id: job._id, status: 'queued' }, { $set: { status: 'cancelled', reason } });
      track('reminder_suppressed', { userId: job.userId, properties: { reason } });
      continue;
    }
    const tokens = (await PushToken.find({ userId: job.userId }).select({ token: 1 }).lean()).map((t) => t.token);
    const result = tokens.length ? await sendExpoPush(tokens) : { ok: false, error: 'no_device' };
    await NotificationJob.updateOne(
      { _id: job._id, status: 'queued' },
      result.ok
        ? { $set: { status: 'sent', sentAt: new Date(), providerMessageId: result.id ?? null } }
        : { $set: { status: 'failed', reason: result.error ?? 'unknown' } },
    );
    track(result.ok ? 'reminder_sent' : 'reminder_failed', { userId: job.userId, properties: { reason: result.error } });
  }
  return due.length;
}
