import { config } from '../config.js';
import { DailyStudyDay, Enrollment, NotificationJob, NotificationPreference, PushToken, StreakState, User } from '../models/index.js';
import { track } from '../lib/analytics.js';
import { displayedStreak } from '../lib/rules.js';
import { effectiveTimezone, inQuietHours, localDate, localTimeOn } from '../lib/time.js';
import { FRIEND_NUDGE_KEY, nudgeCopy, pickTemplate, recordSent, reminderContext, saverTime, smartTime } from './reminders.js';

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

async function currentStreak(userId: string, today: string) {
  const s = await StreakState.findById(userId).lean();
  if (!s) return 0;
  return displayedStreak({ lastStudyDate: s.lastStudyDate ?? null, lastCoveredDate: s.lastCoveredDate ?? null, currentDays: s.currentDays, longestDays: s.longestDays }, today);
}

/**
 * Queues at most one daily reminder per learner-local date, plus an evening
 * streak saver when a streak is at stake. The daily time follows when the
 * learner usually studies (smart timing) or the time they picked, moved out of
 * quiet hours. Unique dedupe keys prevent repeats.
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
    const quietStart = p.quietStart ?? '23:00';
    const quietEnd = p.quietEnd ?? '08:00';
    const desired = (p.smartTiming !== false ? await smartTime(p._id, zone, now) : null) ?? p.dailyLocalTime ?? '21:00';
    const time = inQuietHours(desired, quietStart, quietEnd) ? quietEnd : desired;
    const scheduledAt = localTimeOn(studyDate, time, zone);
    if (scheduledAt > now) {
      const res = await NotificationJob.updateOne(
        { dedupeKey: `daily_goal:${p._id}:${studyDate}` },
        { $setOnInsert: { userId: p._id, kind: 'daily_goal', studyDate, scheduledAt, status: 'queued' } },
        { upsert: true },
      );
      planned += res.upsertedCount;
    }
    const saver = p.streakSaver !== false ? saverTime(time, quietStart) : null;
    if (saver && !inQuietHours(saver, quietStart, quietEnd) && (await currentStreak(p._id, studyDate)) >= 1) {
      const saverAt = localTimeOn(studyDate, saver, zone);
      if (saverAt > now) {
        const res = await NotificationJob.updateOne(
          { dedupeKey: `streak_saver:${p._id}:${studyDate}` },
          { $setOnInsert: { userId: p._id, kind: 'streak_at_risk', studyDate, scheduledAt: saverAt, status: 'queued' } },
          { upsert: true },
        );
        planned += res.upsertedCount;
      }
    }
  }
  return planned;
}

/**
 * Queues a push for a friend's nudge, at most one a day per learner, and only
 * for learners who opted into reminders and aren't in quiet hours.
 */
export async function queueNudgePush(toId: string, from: string, now = new Date()) {
  const prefs = await NotificationPreference.findById(toId).lean();
  if (!prefs?.remindersEnabled) return false;
  const user = await User.findById(toId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  if (!user) return false;
  const zone = effectiveTimezone(user, now);
  const local = now.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
  if (inQuietHours(local, prefs.quietStart ?? '23:00', prefs.quietEnd ?? '08:00')) return false;
  const studyDate = localDate(now, zone);
  const res = await NotificationJob.updateOne(
    { dedupeKey: `nudge:${toId}:${studyDate}` },
    { $setOnInsert: { userId: toId, kind: 'friend_nudge', studyDate, scheduledAt: now, status: 'queued', payload: nudgeCopy(from) } },
    { upsert: true },
  );
  return res.upsertedCount > 0;
}

interface Message {
  title: string;
  body: string;
  route: string;
}

async function sendExpoPush(tokens: string[], message: Message): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!config.EXPO_PUSH_ENABLED) return { ok: false, error: 'push_disabled' };
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title: message.title, body: message.body, data: { route: message.route } }))),
    });
    if (!res.ok) return { ok: false, error: `status_${res.status}` };
    const body = (await res.json()) as { data?: { id?: string; status?: string }[] };
    const first = body.data?.find((d) => d.status === 'ok');
    return first ? { ok: true, id: first.id } : { ok: false, error: 'rejected' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** The words for one job: a friend's fixed nudge, or the bandit's pick for this learner right now. */
async function compose(job: { userId: string; kind: string; studyDate: string; payload?: unknown }, now: Date) {
  if (job.kind === 'friend_nudge') {
    const copy = job.payload as { title: string; body: string };
    return { key: FRIEND_NUDGE_KEY, title: copy.title, body: copy.body, route: '/friends' };
  }
  const user = await User.findById(job.userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  const zone = user ? effectiveTimezone(user, now) : 'Etc/UTC';
  const ctx = await reminderContext(job.userId, job.studyDate, zone, now);
  const template = await pickTemplate(job.userId, ctx, { urgent: job.kind === 'streak_at_risk', now });
  return { key: template.key, ...template.render(ctx), route: '/learn' };
}

/** Rechecks eligibility immediately before each send. Device tokens are never logged. */
export async function dispatchReminders(now = new Date()) {
  const due = await NotificationJob.find({ status: 'queued', scheduledAt: { $lte: now } }).limit(200).lean();
  for (const job of due) {
    const reason = await eligibility(job.userId, job.studyDate);
    if (reason) {
      await NotificationJob.updateOne({ _id: job._id, status: 'queued' }, { $set: { status: 'cancelled', reason } });
      track('reminder_suppressed', { userId: job.userId, properties: { reason, kind: job.kind } });
      continue;
    }
    const message = await compose(job, now);
    const tokens = (await PushToken.find({ userId: job.userId }).select({ token: 1 }).lean()).map((t) => t.token);
    const result = tokens.length ? await sendExpoPush(tokens, message) : { ok: false, error: 'no_device' };
    await NotificationJob.updateOne(
      { _id: job._id, status: 'queued' },
      result.ok
        ? { $set: { status: 'sent', sentAt: new Date(), providerMessageId: result.id ?? null, templateKey: message.key, title: message.title, body: message.body } }
        : { $set: { status: 'failed', reason: result.error ?? 'unknown', templateKey: message.key } },
    );
    if (result.ok) await recordSent(message.key, now);
    track(result.ok ? 'reminder_sent' : 'reminder_failed', { userId: job.userId, properties: { reason: result.error, kind: job.kind, template: message.key } });
  }
  return due.length;
}
