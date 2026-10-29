import { tx } from '../db.js';
import { Attempt, DailyQuestSet, PracticeSession, RewardLedger, User } from '../models/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { sha256 } from '../lib/ids.js';
import { BOOST, CHEST_TABLE, MAX_FREEZES, MONTHLY_QUEST_TARGET, QUEST_TEMPLATES, type QuestMetric } from '../lib/rules.js';
import { addDays, effectiveTimezone, localDate, startOfLocalDay } from '../lib/time.js';
import { awardAchievement } from './achievements.js';
import { celebrate, earnGems, ensureProfile } from './wallet.js';

/** Three quests a day (easy, medium, hard), picked deterministically per learner and date, sized to the daily goal. */
export function pickQuests(userId: string, date: string, goalMinutes: number) {
  const size = goalMinutes >= 15 ? 2 : goalMinutes >= 10 ? 1 : 0;
  const seed = parseInt(sha256(`${userId}:${date}`).slice(0, 8), 16);
  return ([0, 1, 2] as const).map((slot) => {
    const pool = QUEST_TEMPLATES.filter((t) => t.slot === slot);
    const t = pool[(seed >>> (slot * 5)) % pool.length]!;
    const target = t.targets[size];
    return { key: t.key, metric: t.metric, label: t.label(target), target, completedAt: null as Date | null };
  });
}

/** Today's activity, measured from graded attempts, finished sessions and the XP ledger. */
export async function questMetrics(userId: string, date: string, zone: string): Promise<Record<QuestMetric, number>> {
  const range = { $gte: startOfLocalDay(date, zone), $lt: startOfLocalDay(addDays(date, 1), zone) };
  const attempts = await Attempt.find({ userId, submittedAt: range }).select({ sessionId: 1, isCorrect: 1 }).sort({ submittedAt: 1 }).lean();
  let bestRun = 0;
  const runs = new Map<string, number>();
  for (const a of attempts) {
    const run = a.isCorrect ? (runs.get(a.sessionId) ?? 0) + 1 : 0;
    runs.set(a.sessionId, run);
    bestRun = Math.max(bestRun, run);
  }
  const xp = await RewardLedger.aggregate<{ xp: number }>([{ $match: { userId, createdAt: range } }, { $group: { _id: null, xp: { $sum: '$amount' } } }]);
  const sessions = await PracticeSession.find({ userId, completedAt: range, status: { $in: ['completed', 'expired'] } })
    .select({ mode: 1, status: 1, completion: 1 })
    .lean();
  const isLesson = (s: { mode: string; status: string }) => s.status === 'completed' && (s.mode === 'lesson' || s.mode === 'checkpoint');
  const done = (s: { completion?: unknown }) => s.completion as { correct?: number; total?: number } | null;
  return {
    answers: attempts.length,
    correct: attempts.filter((a) => a.isCorrect === true).length,
    xp: xp[0]?.xp ?? 0,
    best_run: bestRun,
    lessons: sessions.filter(isLesson).length,
    perfect: sessions.filter((s) => isLesson(s) && (done(s)?.total ?? 0) >= 5 && done(s)?.correct === done(s)?.total).length,
    sessions: sessions.length,
  };
}

export interface QuestView {
  key: string;
  label: string;
  target: number;
  progress: number;
  done: boolean;
}

/**
 * Creates today's quests if needed, updates progress, and marks newly finished
 * ones (with celebrations and the monthly challenge). Runs inside a transaction.
 */
export async function refreshQuests(userId: string, zone: string, now: Date) {
  const date = localDate(now, zone);
  const user = await User.findById(userId).select({ dailyGoalMinutes: 1 }).lean();
  const set = (await DailyQuestSet.findOneAndUpdate(
    { userId, date },
    { $setOnInsert: { timezone: zone, quests: pickQuests(userId, date, user?.dailyGoalMinutes ?? 5), createdAt: now } },
    { upsert: true, returnDocument: 'after' },
  ))!;
  const metrics = await questMetrics(userId, date, zone);
  const fresh: string[] = [];
  for (const q of set.quests) {
    if (!q.completedAt && metrics[q.metric as QuestMetric] >= q.target) {
      q.completedAt = now;
      fresh.push(q.label);
    }
  }
  if (fresh.length) {
    await set.save();
    for (const label of fresh) await celebrate(userId, 'quest_complete', { label }, `quest:${date}:${label}`);
    if (set.quests.every((q) => q.completedAt)) await celebrate(userId, 'quests_done', { date }, `quests:${date}`);
    await updateMonthlyChallenge(userId, date);
  }
  const quests: QuestView[] = set.quests.map((q) => ({
    key: q.key,
    label: q.label,
    target: q.target,
    progress: Math.min(q.target, metrics[q.metric as QuestMetric]),
    done: !!q.completedAt,
  }));
  return { date, quests, chestAvailable: quests.every((q) => q.done) && !set.chestOpenedAt, chestOpened: !!set.chestOpenedAt, chestReward: set.chestReward ?? null };
}

async function monthlyProgress(userId: string, month: string) {
  const rows = await DailyQuestSet.aggregate<{ n: number }>([
    { $match: { userId, date: { $gte: `${month}-01`, $lte: `${month}-31` } } },
    { $unwind: '$quests' },
    { $match: { 'quests.completedAt': { $ne: null } } },
    { $count: 'n' },
  ]);
  return rows[0]?.n ?? 0;
}

async function updateMonthlyChallenge(userId: string, date: string) {
  const month = date.slice(0, 7);
  if ((await monthlyProgress(userId, month)) >= MONTHLY_QUEST_TARGET) await awardAchievement(userId, `monthly_${month.replace('-', '_')}`);
}

export async function questsView(userId: string, now = new Date()) {
  const user = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  if (!user) throw notFound('User');
  const zone = effectiveTimezone(user, now);
  const today = await tx(() => refreshQuests(userId, zone, now));
  const month = today.date.slice(0, 7);
  return {
    date: today.date,
    quests: today.quests,
    chest: { available: today.chestAvailable, opened: today.chestOpened, reward: today.chestReward },
    monthly: { month, target: MONTHLY_QUEST_TARGET, progress: Math.min(MONTHLY_QUEST_TARGET, await monthlyProgress(userId, month)) },
  };
}

type ChestReward = { kind: 'gems'; amount: number } | { kind: 'xp_boost'; minutes: number; until: string } | { kind: 'streak_freeze' };

/** Opens today's chest once all three quests are done. Repeat calls return the same reward. */
export async function openChest(userId: string, now = new Date()): Promise<ChestReward> {
  const user = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  if (!user) throw notFound('User');
  const zone = effectiveTimezone(user, now);
  return tx(async () => {
    const state = await refreshQuests(userId, zone, now);
    const set = (await DailyQuestSet.findOne({ userId, date: state.date }))!;
    if (set.chestOpenedAt) return set.chestReward as ChestReward;
    if (!state.chestAvailable) throw conflict('quests_incomplete', 'Finish all three quests to open the chest');
    let roll = Math.random() * CHEST_TABLE.reduce((sum, r) => sum + r.weight, 0);
    const pick = CHEST_TABLE.find((r) => (roll -= r.weight) < 0)?.reward ?? CHEST_TABLE[0].reward;
    const profile = await ensureProfile(userId);
    let reward: ChestReward;
    if (pick.kind === 'streak_freeze' && profile.freezes < MAX_FREEZES) {
      profile.freezes += 1;
      await profile.save();
      reward = { kind: 'streak_freeze' };
    } else if (pick.kind === 'xp_boost') {
      const from = profile.boostUntil && profile.boostUntil > now ? profile.boostUntil : now;
      profile.boostUntil = new Date(from.getTime() + BOOST.minutes * 60_000);
      await profile.save();
      reward = { kind: 'xp_boost', minutes: BOOST.minutes, until: profile.boostUntil.toISOString() };
    } else {
      const amount = pick.kind === 'gems' ? pick.amount : 25;
      await earnGems(userId, amount, 'chest', `chest:${state.date}`);
      reward = { kind: 'gems', amount };
    }
    set.chestOpenedAt = now;
    set.chestReward = reward;
    await set.save();
    return reward;
  });
}
