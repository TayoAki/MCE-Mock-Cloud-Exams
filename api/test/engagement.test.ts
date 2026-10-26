import { describe, expect, it } from 'vitest';
import {
  Celebration,
  DailyQuestSet,
  DailyStudyDay,
  EngagementProfile,
  FriendStreak,
  GemLedger,
  LeagueMember,
  ProtectedDay,
  RewardLedger,
  StreakState,
} from '../src/models/index.js';
import { addDays } from '../src/lib/time.js';
import { closeLeagueWeeks, leagueWeek } from '../src/services/leagues.js';
import { answerAll, as, completeLesson, enroll, guest, id, registered, startLesson } from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

async function seedStreak(userId: string, days: number, lastStudyDate: string) {
  await StreakState.updateOne({ _id: userId }, { $set: { currentDays: days, longestDays: days, lastStudyDate, lastCoveredDate: lastStudyDate } }, { upsert: true });
}

async function giveGems(userId: string, gems: number) {
  await EngagementProfile.updateOne({ _id: userId }, { $set: { gems } }, { upsert: true });
}

const buy = (token: string, item: string) => as(token).post('/shop/purchase', { item, client_request_id: id() });

describe('the end-of-lesson summary', () => {
  it('reports accuracy, gems, level, quests and the celebrations to play', async () => {
    const { token } = await guest('Etc/UTC');
    const enrollmentId = await enroll(token);
    const done = await completeLesson(token, enrollmentId);
    const e = done.engagement;
    expect(e).toMatchObject({ accuracy: 60, chest_available: false });
    // 75 XP crosses level 2 (50 XP).
    expect(e.level).toMatchObject({ level: 2, title: 'Intern', xp: 75, leveled_up: true });
    // 5 lesson gems plus 20 for the first-lesson badge.
    expect(e.gems_earned).toBe(25);
    expect(e.gems_total).toBe(25);
    expect(e.quests).toHaveLength(3);
    expect(e.league).toMatchObject({ tier: 'bronze', rank: 1, xp: 75 });
    const kinds = e.celebrations.map((c: { kind: string }) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['level_up', 'achievement']));

    // The same celebrations wait in the queue until the app marks them seen.
    const queue = await as(token).get('/me/celebrations').expect(200);
    expect(queue.body.celebrations.map((c: { id: string }) => c.id)).toEqual(e.celebrations.map((c: { id: string }) => c.id));
    await as(token).post('/me/celebrations/seen', { ids: queue.body.celebrations.map((c: { id: string }) => c.id) }).expect(204);
    expect((await as(token).get('/me/celebrations').expect(200)).body.celebrations).toEqual([]);

    // A retried completion returns the same stored summary and grants nothing new.
    const again = await as(token).post(`/sessions/${done.session_id}/complete`).expect(200);
    expect(again.body.engagement).toEqual(e);
    expect((await as(token).get('/me/engagement').expect(200)).body.gems).toBe(25);
  });

  it('a perfect lesson earns bonus XP and gems once', async () => {
    // One learner reveals the first lesson's keys; a second answers them all correctly.
    const { token } = await guest();
    const receipts = await answerAll(token, await startLesson(token, await enroll(token)));
    const keys = receipts.map((r) => r.feedback.correct_options[0]);
    const other = await guest();
    const otherEnrollment = await enroll(other.token);
    const perfectSession = await startLesson(other.token, otherEnrollment);
    await answerAll(other.token, perfectSession, keys);
    const done = await as(other.token).post(`/sessions/${perfectSession.id}/complete`).expect(200);
    expect(done.body.correct).toBe(5);
    expect(done.body.xp_granted).toBe(5 * 15 + 10 + 5);
    expect(await RewardLedger.countDocuments({ userId: other.userId, reasonCode: 'perfect_lesson' })).toBe(1);
    expect(await GemLedger.countDocuments({ userId: other.userId, reason: 'perfect_lesson' })).toBe(1);
    expect(done.body.engagement.celebrations.map((c: { kind: string }) => c.kind)).toContain('achievement');
  });
});

describe('daily quests and the chest', () => {
  it('opens one chest after all three quests, and repeats return the same reward', async () => {
    const { token, userId } = await guest('Etc/UTC');
    const enrollmentId = await enroll(token);
    const before = await as(token).get('/me/quests').expect(200);
    expect(before.body.quests).toHaveLength(3);
    expect(before.body.chest.available).toBe(false);
    await as(token).post('/me/quests/chest').expect(409);
    // Make today's quests easy to finish, then answer a lesson.
    await DailyQuestSet.updateOne(
      { userId, date: before.body.date },
      { $set: { quests: ['a', 'b', 'c'].map((k) => ({ key: k, metric: 'answers', label: `Answer a question (${k})`, target: 1, completedAt: null })) } },
    );
    await completeLesson(token, enrollmentId);
    const after = await as(token).get('/me/quests').expect(200);
    expect(after.body.quests.every((q: { done: boolean }) => q.done)).toBe(true);
    expect(after.body.chest.available).toBe(true);
    expect(after.body.monthly).toMatchObject({ target: 30, progress: 3 });
    const first = await as(token).post('/me/quests/chest').expect(200);
    const second = await as(token).post('/me/quests/chest').expect(200);
    expect(second.body.reward).toEqual(first.body.reward);
    expect(['gems', 'xp_boost', 'streak_freeze']).toContain(first.body.reward.kind);
    expect((await as(token).get('/me/quests').expect(200)).body.chest).toMatchObject({ available: false, opened: true });
  });

  it('an XP boost doubles answer XP while it lasts', async () => {
    const { token, userId } = await guest();
    const enrollmentId = await enroll(token);
    await EngagementProfile.updateOne({ _id: userId }, { $set: { boostUntil: new Date(Date.now() + 10 * 60_000) } }, { upsert: true });
    const session = await startLesson(token, enrollmentId);
    const [first] = await answerAll(token, { ...session, items: session.items.slice(0, 1) });
    expect(first.xp_granted).toBe(first.feedback.correct ? 30 : 20);
  });
});

describe('streak protection', () => {
  it('a freeze covers one missed day automatically and shows on the week', async () => {
    const { token, userId } = await guest('Etc/UTC');
    await seedStreak(userId, 5, addDays(today(), -2));
    await EngagementProfile.updateOne({ _id: userId }, { $set: { freezes: 1 } }, { upsert: true });
    const me = await as(token).get('/me').expect(200);
    expect(me.body.streak.current).toBe(5);
    const yesterday = addDays(today(), -1);
    expect(await ProtectedDay.findOne({ userId, date: yesterday }).lean()).toMatchObject({ source: 'freeze' });
    expect((await as(token).get('/me/engagement').expect(200)).body.freezes).toBe(0);
    expect(await Celebration.exists({ userId, kind: 'freeze_used' })).toBeTruthy();
    // A frozen day is never a study day.
    expect(await DailyStudyDay.exists({ userId, studyDate: yesterday })).toBeNull();
  });

  it('without enough freezes the streak breaks, keeps them, and can be repaired with gems', async () => {
    const { token, userId } = await guest('Etc/UTC');
    await seedStreak(userId, 6, addDays(today(), -3));
    await EngagementProfile.updateOne({ _id: userId }, { $set: { freezes: 1 } }, { upsert: true });
    expect((await as(token).get('/me').expect(200)).body.streak.current).toBe(0);
    const e = (await as(token).get('/me/engagement').expect(200)).body;
    expect(e.freezes).toBe(1);
    expect(e.repair).toMatchObject({ days: 6, price: 350 });
    expect((await buy(token, 'streak_repair').expect(409)).body.code).toBe('not_enough_gems');
    await giveGems(userId, 400);
    const repaired = await buy(token, 'streak_repair').expect(200);
    expect(repaired.body).toMatchObject({ gems: 50, repair: null });
    expect((await as(token).get('/me').expect(200)).body.streak.current).toBe(6);
    expect(await ProtectedDay.countDocuments({ userId, source: 'repair' })).toBe(2);
    // Studying today continues the restored streak.
    const done = await completeLesson(token, await enroll(token));
    expect(done.current_streak).toBe(7);
  });

  it('sells at most two freezes, one amulet per weekend, and replays a purchase without charging twice', async () => {
    const { token, userId } = await guest('Etc/UTC');
    await giveGems(userId, 1000);
    const key = id();
    const a = await as(token).post('/shop/purchase', { item: 'streak_freeze', client_request_id: key }).expect(200);
    const replay = await as(token).post('/shop/purchase', { item: 'streak_freeze', client_request_id: key }).expect(200);
    expect(replay.body).toEqual(a.body);
    expect(a.body).toMatchObject({ freezes: 1, gems: 800 });
    await buy(token, 'streak_freeze').expect(200);
    expect((await buy(token, 'streak_freeze').expect(409)).body.code).toBe('freezes_full');
    const amulet = await buy(token, 'weekend_amulet').expect(200);
    expect(amulet.body.amulet.saturday).toBeTruthy();
    expect((await buy(token, 'weekend_amulet').expect(409)).body.code).toBe('amulet_active');
    expect((await as(token).get('/me/engagement').expect(200)).body.gems).toBe(1000 - 400 - 150);
  });

  it('a streak wager pays double after seven covered days', async () => {
    const { token, userId } = await guest('Etc/UTC');
    await giveGems(userId, 50);
    await buy(token, 'streak_wager').expect(200);
    expect((await buy(token, 'streak_wager').expect(409)).body.code).toBe('wager_active');
    // Pretend the wager started six days ago and the streak has held since.
    await EngagementProfile.updateOne({ _id: userId }, { $set: { 'wager.startedOn': addDays(today(), -6) } });
    await seedStreak(userId, 6, addDays(today(), -1));
    await completeLesson(token, await enroll(token));
    const e = (await as(token).get('/me/engagement').expect(200)).body;
    expect(e.wager.status).toBe('won');
    expect(await GemLedger.exists({ userId, reason: 'wager_won', amount: 100 })).toBeTruthy();
  });

  it('a streak milestone celebrates and awards the badge', async () => {
    const { token, userId } = await guest('Etc/UTC');
    await seedStreak(userId, 2, addDays(today(), -1));
    const done = await completeLesson(token, await enroll(token));
    expect(done.current_streak).toBe(3);
    expect(done.engagement.celebrations.map((c: { kind: string }) => c.kind)).toContain('streak_milestone');
    const badges = (await as(token).get('/me/achievements').expect(200)).body.badges;
    expect(badges.find((b: { key: string }) => b.key === 'streak_3').earned_at).toBeTruthy();
  });
});

describe('leagues', () => {
  it('places learners in a weekly cohort, ranks them by XP, and moves them when the week closes', async () => {
    // Close any cohorts left by earlier tests in this file so this week's table is predictable.
    await closeLeagueWeeks(new Date(Date.now() + 8 * 86_400_000));
    const a = await registered();
    const b = await registered();
    await completeLesson(a.token, await enroll(a.token));
    await completeLesson(b.token, await enroll(b.token));
    const table = (await as(a.token).get('/leagues/current').expect(200)).body;
    expect(table).toMatchObject({ joined: true, tier: 'bronze' });
    const mine = table.rows.find((r: { is_me: boolean }) => r.is_me);
    expect(mine.xp).toBe(75);
    // Hiding takes you off the table.
    await as(b.token).put('/me/league-visibility', { hidden: true }).expect(200);
    expect((await as(b.token).get('/leagues/current').expect(200)).body.joined).toBe(false);
    await as(b.token).put('/me/league-visibility', { hidden: false }).expect(200);

    const week = leagueWeek(new Date()).weekStart;
    const closed = await closeLeagueWeeks(new Date(Date.now() + 8 * 86_400_000));
    expect(closed).toBeGreaterThan(0);
    const members = await LeagueMember.find({ weekStart: week, userId: { $in: [a.userId, b.userId] } }).lean();
    expect(members.every((m) => m.finalRank && m.outcome)).toBe(true);
    expect(members.some((m) => m.outcome === 'promoted')).toBe(true);
    const promoted = members.find((m) => m.outcome === 'promoted')!;
    expect((await EngagementProfile.findById(promoted.userId).lean())!.leagueTier).toBe('silver');
    expect(await Celebration.exists({ userId: promoted.userId, kind: 'league_result' })).toBeTruthy();
    // Closing again does nothing.
    expect(await closeLeagueWeeks(new Date(Date.now() + 8 * 86_400_000))).toBe(0);
  });
});

describe('friends', () => {
  async function circleOf() {
    const owner = await registered('Etc/UTC');
    const friend = await registered('Etc/UTC');
    const circle = await as(owner.token).post('/circles', { name: 'Crew', timezone: 'Etc/UTC', weekly_target_days: 4 }).expect(201);
    const invite = await as(owner.token).post(`/circles/${circle.body.id}/invites`).expect(201);
    const token = new URL(invite.body.invite_url.replace('certpath://', 'https://x/')).searchParams.get('token');
    await as(friend.token).post('/circle-joins', { token }).expect(200);
    return { owner, friend, circleId: circle.body.id as string };
  }

  it('friend streaks start by invitation, count days both studied, and stay within circles', async () => {
    const { owner, friend } = await circleOf();
    const outsider = await registered();
    expect((await as(owner.token).post('/friend-streaks', { friend_id: outsider.userId }).expect(403)).body.code).toBe('not_in_circle');
    const invited = await as(owner.token).post('/friend-streaks', { friend_id: friend.userId }).expect(201);
    const streakId = invited.body.friend_streaks[0].id;
    expect(invited.body.friend_streaks[0]).toMatchObject({ status: 'pending', invited_by_me: true });
    await as(owner.token).post(`/friend-streaks/${streakId}/accept`).expect(409);
    await as(friend.token).post(`/friend-streaks/${streakId}/accept`).expect(200);

    await completeLesson(owner.token, await enroll(owner.token));
    expect((await FriendStreak.findById(streakId).lean())!.currentDays).toBe(0);
    await completeLesson(friend.token, await enroll(friend.token));
    const view = (await as(owner.token).get('/friend-streaks').expect(200)).body.friend_streaks[0];
    expect(view).toMatchObject({ status: 'active', current: 1, me_today: true, friend_today: true });
    expect(await Celebration.exists({ userId: owner.userId, kind: 'friend_streak' })).toBeTruthy();
  });

  it('high-fives once a day, nudges only friends who have not studied, and shows circle activity', async () => {
    const { owner, friend, circleId } = await circleOf();
    await as(owner.token).post(`/friends/${friend.userId}/nudge`).expect(201);
    await completeLesson(friend.token, await enroll(friend.token));
    expect((await as(owner.token).post(`/friends/${friend.userId}/nudge`).expect(409)).body.code).toBe('already_studied');
    await as(owner.token).post(`/friends/${friend.userId}/high-five`).expect(201);
    expect((await as(owner.token).post(`/friends/${friend.userId}/high-five`).expect(409)).body.code).toBe('already_sent');
    const kinds = (await Celebration.find({ userId: friend.userId }).lean()).map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['nudge', 'high_five']));
    const activity = (await as(owner.token).get(`/circles/${circleId}/activity`).expect(200)).body;
    expect(activity.quest).toMatchObject({ target: 200, done: false });
    expect(activity.feed[0]).toMatchObject({ kind: 'lesson_completed', is_you: false });
    expect(activity.members.find((m: { is_you: boolean }) => !m.is_you)).toMatchObject({ high_fived_today: true, studied_today: true });
    expect(activity.members.find((m: { is_you: boolean }) => m.is_you)).toMatchObject({ studied_today: false });
  });

  it('the circle quest pays every member once the circle reaches its weekly XP', async () => {
    const { owner, friend } = await circleOf();
    await RewardLedger.create({ userId: friend.userId, amount: 150, reasonCode: 'manual_adjustment', sourceType: 'manual', sourceId: id(), idempotencyKey: id() });
    await completeLesson(owner.token, await enroll(owner.token));
    for (const u of [owner, friend]) {
      expect(await GemLedger.exists({ userId: u.userId, reason: 'circle_quest' })).toBeTruthy();
      expect(await Celebration.exists({ userId: u.userId, kind: 'circle_quest' })).toBeTruthy();
    }
  });
});
