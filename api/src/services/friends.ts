import { tx } from '../db.js';
import {
  CircleMember,
  DailyStudyDay,
  FriendStreak,
  HighFive,
  LeagueMember,
  PracticeSession,
  RewardLedger,
  StudyCircle,
  User,
  type UserRecord,
} from '../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { GEMS, MAX_FRIEND_STREAKS } from '../lib/rules.js';
import { addDays, daysBetween, effectiveTimezone, localDate } from '../lib/time.js';
import { awardAchievement } from './achievements.js';
import { leagueWeek, publicName } from './leagues.js';
import { celebrate, earnGems } from './wallet.js';

/**
 * Friend streaks, high-fives, nudges and the weekly circle quest. Friends are
 * people you share an active study circle with: CertPath has no open friend
 * graph and never uploads contacts.
 */

async function circleIdsOf(userId: string) {
  return (await CircleMember.find({ userId, status: 'active' }).select({ circleId: 1 }).lean()).map((m) => m.circleId);
}

export async function sharesCircle(a: string, b: string) {
  const mine = await circleIdsOf(a);
  return !!(await CircleMember.exists({ userId: b, status: 'active', circleId: { $in: mine } }));
}

const pairOf = (a: string, b: string) => [a, b].sort() as [string, string];

/** A friend streak shows as broken once a full day passes without both studying. */
function displayedDays(s: { currentDays: number; lastDate?: string | null }, today: string) {
  return s.lastDate && daysBetween(s.lastDate, today) <= 1 ? s.currentDays : 0;
}

async function zoneOf(userId: string, now: Date) {
  const u = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  return u ? effectiveTimezone(u, now) : 'Etc/UTC';
}

export async function friendStreaksView(userId: string, now = new Date()) {
  const today = localDate(now, await zoneOf(userId, now));
  const rows = await FriendStreak.find({ pair: userId, status: { $in: ['pending', 'active'] } }).sort({ createdAt: 1 }).lean();
  const friendIds = rows.map((r) => r.pair.find((p) => p !== userId)!);
  const users = new Map((await User.find({ _id: { $in: friendIds } }).select({ displayName: 1, isGuest: 1 }).lean()).map((u) => [u._id, u]));
  const studied = new Set(
    (await DailyStudyDay.find({ userId: { $in: [userId, ...friendIds] }, studyDate: today }).select({ userId: 1 }).lean()).map((d) => d.userId),
  );
  return rows.map((r) => {
    const friendId = r.pair.find((p) => p !== userId)!;
    const u = users.get(friendId);
    return {
      id: r._id,
      friend: { id: friendId, name: u ? publicName(u) : 'Learner' },
      status: r.status,
      invited_by_me: r.inviterId === userId,
      current: displayedDays(r, today),
      longest: r.longestDays,
      me_today: studied.has(userId),
      friend_today: studied.has(friendId),
    };
  });
}

export async function inviteFriendStreak(user: UserRecord, friendId: string) {
  if (friendId === user._id) throw badRequest('invalid_friend', 'Pick someone else');
  if (!(await sharesCircle(user._id, friendId))) throw forbidden('not_in_circle', 'You can start a friend streak with people in your study circles');
  const [a, b] = pairOf(user._id, friendId);
  const open = async (id: string) => FriendStreak.countDocuments({ pair: id, status: { $in: ['pending', 'active'] } });
  if ((await open(user._id)) >= MAX_FRIEND_STREAKS || (await open(friendId)) >= MAX_FRIEND_STREAKS) {
    throw conflict('friend_streak_limit', `Friend streaks are limited to ${MAX_FRIEND_STREAKS} at a time`);
  }
  const existing = await FriendStreak.findOne({ pairKey: `${a}:${b}` });
  if (existing && existing.status !== 'ended') throw conflict('friend_streak_exists', 'You already have a friend streak together');
  if (existing) {
    Object.assign(existing, { status: 'pending', inviterId: user._id, currentDays: 0, lastDate: null, createdAt: new Date(), acceptedAt: null });
    await existing.save();
  } else {
    await FriendStreak.create({ pair: [a, b], pairKey: `${a}:${b}`, inviterId: user._id });
  }
  return friendStreaksView(user._id);
}

export async function respondFriendStreak(user: UserRecord, id: string, action: 'accept' | 'decline' | 'end') {
  const row = await FriendStreak.findOne({ _id: id, pair: user._id });
  if (!row || row.status === 'ended') throw notFound('Friend streak');
  if (action === 'accept') {
    if (row.status !== 'pending' || row.inviterId === user._id) throw conflict('not_invited', 'Only the invited friend can accept');
    row.status = 'active';
    row.acceptedAt = new Date();
  } else {
    row.status = 'ended';
  }
  await row.save();
  return friendStreaksView(user._id);
}

/**
 * Runs inside the completion transaction when the learner earns today's study
 * day: extends friend streaks whose partner already studied on this date, and
 * checks each of the learner's circle quests.
 */
export async function onStudyDay(userId: string, today: string) {
  const streaks = await FriendStreak.find({ pair: userId, status: 'active' });
  for (const s of streaks) {
    const friendId = s.pair.find((p) => p !== userId)!;
    if (s.lastDate === today || !(await DailyStudyDay.exists({ userId: friendId, studyDate: today }))) continue;
    s.currentDays = s.lastDate === addDays(today, -1) ? s.currentDays + 1 : 1;
    s.longestDays = Math.max(s.longestDays, s.currentDays);
    s.lastDate = today;
    await s.save();
    const names = new Map((await User.find({ _id: { $in: s.pair } }).select({ displayName: 1, isGuest: 1 }).lean()).map((u) => [u._id, publicName(u)]));
    for (const who of s.pair) {
      const other = s.pair.find((p) => p !== who)!;
      await celebrate(who, 'friend_streak', { friend: names.get(other) ?? 'Your friend', days: s.currentDays }, `fs:${s._id}:${today}`);
      if (s.currentDays >= 7) await awardAchievement(who, 'friend_streak_7');
    }
  }
  for (const circleId of await circleIdsOf(userId)) await checkCircleQuest(circleId, new Date());
}

/** The circle's shared weekly goal: XP together, scaled to the number of members. */
async function circleQuestState(circleId: string, now: Date) {
  const members = await CircleMember.find({ circleId, status: 'active' }).select({ userId: 1 }).lean();
  const ids = members.map((m) => m.userId);
  const { startsAt, endsAt, weekStart } = leagueWeek(now);
  const target = Math.min(1500, 100 * Math.max(1, ids.length));
  const rows = await RewardLedger.aggregate<{ xp: number }>([
    { $match: { userId: { $in: ids }, createdAt: { $gte: startsAt, $lt: endsAt } } },
    { $group: { _id: null, xp: { $sum: '$amount' } } },
  ]);
  return { ids, weekStart, target, progress: rows[0]?.xp ?? 0, endsAt };
}

async function checkCircleQuest(circleId: string, now: Date) {
  const q = await circleQuestState(circleId, now);
  if (q.progress < q.target) return;
  const circle = await StudyCircle.findById(circleId).select({ name: 1 }).lean();
  for (const id of q.ids) {
    const gems = await earnGems(id, GEMS.circleQuest, 'circle_quest', `cq:${circleId}:${q.weekStart}`);
    if (gems) await celebrate(id, 'circle_quest', { circle: circle?.name ?? 'Your circle', gems }, `cq:${circleId}:${q.weekStart}`);
  }
}

/** One high-five (or nudge) per friend per day. Nudges go to friends who haven't studied yet today. */
export async function sendHighFive(user: UserRecord, toId: string, kind: 'high_five' | 'nudge', now = new Date()) {
  if (toId === user._id) throw badRequest('invalid_friend', 'Pick someone else');
  if (!(await sharesCircle(user._id, toId))) throw forbidden('not_in_circle', 'You can only cheer people in your study circles');
  const date = localDate(now, await zoneOf(user._id, now));
  if (kind === 'nudge' && (await DailyStudyDay.exists({ userId: toId, studyDate: localDate(now, await zoneOf(toId, now)) }))) {
    throw conflict('already_studied', 'They already studied today. Send a high-five instead');
  }
  const created = await tx(async () => {
    const existing = await HighFive.findOne({ fromId: user._id, toId, kind, date }).lean();
    if (existing) return null;
    const [row] = await HighFive.create([{ fromId: user._id, toId, kind, date }]);
    await celebrate(toId, kind, { from: publicName(user) }, `hf:${row!._id}`);
    return row;
  });
  if (!created) throw conflict('already_sent', kind === 'nudge' ? 'You already nudged them today' : 'You already high-fived them today');
  if (kind === 'high_five') await tx(() => awardAchievement(user._id, 'high_five_10').then(() => undefined));
  return { sent: true, kind };
}

/** Recent wins in a circle (finished lessons and badges) plus the shared weekly quest. */
export async function circleActivity(userId: string, circleId: string, now = new Date()) {
  if (!(await CircleMember.exists({ circleId, userId, status: 'active' }))) throw notFound('Circle');
  const q = await circleQuestState(circleId, now);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const users = new Map((await User.find({ _id: { $in: q.ids } }).select({ displayName: 1, isGuest: 1 }).lean()).map((u) => [u._id, publicName(u)]));
  const lessons = await PracticeSession.find({ userId: { $in: q.ids }, status: 'completed', mode: { $in: ['lesson', 'checkpoint'] }, completedAt: { $gte: since } })
    .select({ userId: 1, completedAt: 1, completion: 1 })
    .sort({ completedAt: -1 })
    .limit(20)
    .lean();
  const today = localDate(now, await zoneOf(userId, now));
  const sentToday = new Set((await HighFive.find({ fromId: userId, date: today, kind: 'high_five' }).select({ toId: 1 }).lean()).map((h) => h.toId));
  const weekly = new Map(
    (await LeagueMember.find({ userId: { $in: q.ids }, weekStart: q.weekStart }).select({ userId: 1, xp: 1 }).lean()).map((m) => [m.userId, m.xp]),
  );
  return {
    quest: { target: q.target, progress: Math.min(q.target, q.progress), done: q.progress >= q.target, ends_at: q.endsAt.toISOString(), reward_gems: GEMS.circleQuest },
    members: q.ids.map((id) => ({ user_id: id, name: users.get(id) ?? 'Learner', is_you: id === userId, weekly_xp: weekly.get(id) ?? 0, high_fived_today: sentToday.has(id) })),
    feed: lessons.map((l) => ({
      user_id: l.userId,
      name: users.get(l.userId) ?? 'Learner',
      is_you: l.userId === userId,
      kind: 'lesson_completed' as const,
      at: l.completedAt!.toISOString(),
    })),
  };
}
