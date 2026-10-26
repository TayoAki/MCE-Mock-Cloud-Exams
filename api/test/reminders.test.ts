import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { Celebration, NotificationJob, PracticeSession, PushToken, ReminderArm, StreakState } from '../src/models/index.js';
import { addDays } from '../src/lib/time.js';
import { dispatchReminders, planReminders } from '../src/services/notifications.js';
import { pickTemplate, recencyFactor, sampleBeta, saverTime, smartTime, type ReminderContext } from '../src/services/reminders.js';
import { as, completeLesson, enroll, guest, id, registered } from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

const plain: ReminderContext = { name: null, streak: 0, longest: 0, freezes: 0, wagerDay: null, quest: null, league: null, friend: null, exam: null, level: null };

function stubPush() {
  const mutable = config as { EXPO_PUSH_ENABLED: boolean };
  const before = mutable.EXPO_PUSH_ENABLED;
  mutable.EXPO_PUSH_ENABLED = true;
  const fetch = vi.fn(async (_url: string, init: { body: string }) => {
    const messages = JSON.parse(init.body) as unknown[];
    return new Response(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: id() })) }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    restore: () => {
      mutable.EXPO_PUSH_ENABLED = before;
      vi.unstubAllGlobals();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the reminder bandit', () => {
  it('samples Beta draws around their mean', () => {
    const draws = Array.from({ length: 4000 }, () => sampleBeta(3, 7));
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.27);
    expect(mean).toBeLessThan(0.33);
    expect(draws.every((x) => x > 0 && x < 1)).toBe(true);
  });

  it('only offers wording whose facts are true, and the saver only urgent wording', async () => {
    const { userId } = await guest('Etc/UTC');
    for (let i = 0; i < 30; i++) expect(['gentle', 'two_minutes']).toContain((await pickTemplate(userId, plain)).key);
    const atStake = { ...plain, streak: 6, friend: { name: 'Sam', days: 4 } };
    const urgent = new Set<string>();
    for (let i = 0; i < 40; i++) urgent.add((await pickTemplate(userId, atStake, { urgent: true })).key);
    expect([...urgent].every((k) => ['streak_alive', 'streak_milestone', 'friend_waiting'].includes(k))).toBe(true);
    expect(urgent.has('streak_alive') && urgent.has('friend_waiting')).toBe(true);
  });

  it('learns from everyone, then from the learner, and avoids repeating yesterday’s words', async () => {
    await ReminderArm.create([
      { _id: 'two_minutes', sent: 200, converted: 120 },
      { _id: 'gentle', sent: 200, converted: 10 },
    ]);
    const { userId } = await guest('Etc/UTC');
    let picks = 0;
    for (let i = 0; i < 40; i++) if ((await pickTemplate(userId, plain)).key === 'two_minutes') picks++;
    expect(picks).toBeGreaterThanOrEqual(36);

    // Sent to this learner an hour ago: the strong template steps aside today.
    await NotificationJob.create({ userId, kind: 'daily_goal', studyDate: today(), scheduledAt: new Date(), status: 'sent', dedupeKey: id(), templateKey: 'two_minutes', sentAt: new Date(Date.now() - 3_600_000) });
    picks = 0;
    for (let i = 0; i < 40; i++) if ((await pickTemplate(userId, plain)).key === 'gentle') picks++;
    expect(picks).toBeGreaterThanOrEqual(30);
    expect(recencyFactor(new Date(Date.now() - 2 * 86_400_000), new Date())).toBeCloseTo(0.75, 2);
  });
});

describe('reminder timing', () => {
  it('sends half an hour before the learner usually studies, and the saver late in the evening', async () => {
    const { userId } = await guest('Etc/UTC');
    expect(await smartTime(userId, 'Etc/UTC')).toBeNull();
    for (let d = 1; d <= 3; d++) {
      const at = new Date(`${addDays(today(), -d)}T19:10:00Z`);
      await PracticeSession.create({ userId, enrollmentId: id(), examVersionId: id(), mode: 'quick', status: 'completed', questionCount: 5, clientSessionId: id(), startedAt: at, completedAt: at });
    }
    expect(await smartTime(userId, 'Etc/UTC')).toBe('18:40');
    expect(await smartTime(userId, 'Asia/Tokyo')).toBe('08:00');
    expect(saverTime('18:40', '23:00')).toBe('22:00');
    expect(saverTime('21:00', '23:00')).toBeNull();
    expect(saverTime('09:00', '21:30')).toBe('20:30');
  });

  it('plans a streak saver only when a streak is at stake', async () => {
    const { token, userId } = await guest('Etc/UTC');
    await enroll(token);
    await as(token).patch('/me/preferences', { reminders_enabled: true, daily_local_time: '09:00', quiet_start: '23:00', quiet_end: '07:00' }).expect(200);
    const morning = new Date(`${today()}T06:00:00Z`);
    await planReminders(morning);
    expect((await NotificationJob.find({ userId }).lean()).map((j) => j.kind)).toEqual(['daily_goal']);

    await StreakState.updateOne({ _id: userId }, { $set: { currentDays: 5, longestDays: 5, lastStudyDate: addDays(today(), -1), lastCoveredDate: addDays(today(), -1) } }, { upsert: true });
    await planReminders(morning);
    const saver = await NotificationJob.findOne({ userId, kind: 'streak_at_risk' }).lean();
    expect(saver!.scheduledAt.toISOString()).toBe(`${today()}T22:00:00.000Z`);

    // Turning the saver off stops it from being planned on later days.
    const prefs = await as(token).patch('/me/preferences', { streak_saver: false, smart_timing: false }).expect(200);
    expect(prefs.body.preferences).toMatchObject({ streak_saver: false, smart_timing: false });
  });
});

describe('sending and learning', () => {
  it('words each reminder with the bandit, counts the send, and credits a study day within six hours', async () => {
    const push = stubPush();
    try {
      await ReminderArm.deleteMany({});
      const { token, userId } = await guest('Etc/UTC');
      const enrollmentId = await enroll(token);
      await as(token).patch('/me/preferences', { reminders_enabled: true }).expect(200);
      await as(token).post('/me/push-tokens', { token: 'ExponentPushToken[test-device-1]', platform: 'ios' }).expect(204);
      await NotificationJob.create({ userId, kind: 'daily_goal', studyDate: today(), scheduledAt: new Date(Date.now() - 1000), status: 'queued', dedupeKey: id() });
      await dispatchReminders();
      const sent = await NotificationJob.findOne({ userId }).lean();
      expect(sent).toMatchObject({ status: 'sent' });
      expect(['gentle', 'two_minutes', 'level_close']).toContain(sent!.templateKey);
      const message = JSON.parse(push.fetch.mock.calls[0]![1].body)[0];
      expect(message).toMatchObject({ to: 'ExponentPushToken[test-device-1]', title: sent!.title, body: sent!.body, data: { route: '/learn' } });
      expect((await ReminderArm.findById(sent!.templateKey).lean())!.sent).toBe(1);

      await completeLesson(token, enrollmentId);
      expect((await NotificationJob.findOne({ userId }).lean())!.convertedAt).toBeTruthy();
      expect((await ReminderArm.findById(sent!.templateKey).lean())!.converted).toBe(1);
    } finally {
      push.restore();
    }
  });

  it('a nudge pushes once a day to a friend who opted in', async () => {
    const push = stubPush();
    try {
      const owner = await registered('Etc/UTC');
      const friend = await registered('Etc/UTC');
      const circle = await as(owner.token).post('/circles', { name: 'Crew', timezone: 'Etc/UTC', weekly_target_days: 4 }).expect(201);
      const invite = await as(owner.token).post(`/circles/${circle.body.id}/invites`).expect(201);
      const inviteToken = new URL(invite.body.invite_url.replace('certpath://', 'https://x/')).searchParams.get('token');
      await as(friend.token).post('/circle-joins', { token: inviteToken }).expect(200);
      await enroll(friend.token);

      // Not opted in: the nudge is still a celebration in the app, but no push.
      await as(owner.token).post(`/friends/${friend.userId}/nudge`).expect(201);
      expect(await Celebration.exists({ userId: friend.userId, kind: 'nudge' })).toBeTruthy();
      expect(await NotificationJob.countDocuments({ userId: friend.userId, kind: 'friend_nudge' })).toBe(0);

      await as(friend.token).patch('/me/preferences', { reminders_enabled: true, quiet_start: '00:00', quiet_end: '00:00' }).expect(200);
      await PushToken.create({ userId: friend.userId, token: 'ExponentPushToken[friend-device]', platform: 'ios' });
      await NotificationJob.deleteMany({ userId: friend.userId });
      const third = await registered('Etc/UTC');
      const invite2 = await as(owner.token).post(`/circles/${circle.body.id}/invites`).expect(201);
      await as(third.token).post('/circle-joins', { token: new URL(invite2.body.invite_url.replace('certpath://', 'https://x/')).searchParams.get('token') }).expect(200);
      await as(third.token).post(`/friends/${friend.userId}/nudge`).expect(201);
      expect(await NotificationJob.countDocuments({ userId: friend.userId, kind: 'friend_nudge' })).toBe(1);
      await dispatchReminders();
      const job = await NotificationJob.findOne({ userId: friend.userId, kind: 'friend_nudge' }).lean();
      expect(job).toMatchObject({ status: 'sent', templateKey: 'friend_nudge' });
      const message = JSON.parse(push.fetch.mock.calls.at(-1)![1].body)[0];
      expect(message.title).toMatch(/nudged you$/);
      expect(message.data).toEqual({ route: '/friends' });
    } finally {
      push.restore();
    }
  });
});
