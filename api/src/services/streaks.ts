import { DailyStudyDay, ProtectedDay, StreakState } from '../models/index.js';
import { conflict } from '../lib/errors.js';
import {
  GEMS,
  STREAK_MILESTONES,
  STREAK_REPAIR_DAYS,
  WAGER_DAYS,
  amuletWeekend,
  coveredThrough,
  creditStreak,
  missedDates,
  planProtection,
  type StreakState as StreakValues,
} from '../lib/rules.js';
import { addDays, daysBetween } from '../lib/time.js';
import { awardAchievement } from './achievements.js';
import { celebrate, earnGems, ensureProfile } from './wallet.js';

/**
 * Streak extras: freezes, the weekend amulet, repairs, wagers and milestones.
 * Every function here runs inside the caller's transaction.
 */

async function loadStreak(userId: string) {
  return (await StreakState.findOneAndUpdate(
    { _id: userId },
    { $setOnInsert: { currentDays: 0, longestDays: 0, lastStudyDate: null, lastCoveredDate: null } },
    { upsert: true, returnDocument: 'after' },
  ))!;
}

const values = (s: { lastStudyDate?: string | null; lastCoveredDate?: string | null; currentDays: number; longestDays: number }): StreakValues => ({
  lastStudyDate: s.lastStudyDate ?? null,
  lastCoveredDate: s.lastCoveredDate ?? null,
  currentDays: s.currentDays,
  longestDays: s.longestDays,
});

/** Pays out a wager once the streak has covered its seven days. */
async function settleWager(userId: string, profile: Awaited<ReturnType<typeof ensureProfile>>, covered: string | null, today: string) {
  const wager = profile.wager;
  if (!wager || wager.status !== 'active' || !covered) return;
  if (daysBetween(wager.startedOn, covered) < WAGER_DAYS - 1) return;
  wager.status = 'won';
  wager.resolvedOn = today;
  await profile.save();
  const gems = await earnGems(userId, GEMS.wagerPayout, 'wager_won', `wager:${wager.startedOn}:payout`);
  await celebrate(userId, 'wager_won', { gems }, `wager_won:${wager.startedOn}`);
}

/**
 * Brings the streak up to date before today: missed days are protected by the
 * weekend amulet and freezes when all of them can be covered; otherwise the
 * streak breaks (freezes are kept) and a repair becomes possible.
 */
export async function syncStreak(userId: string, today: string) {
  const streak = await loadStreak(userId);
  const profile = await ensureProfile(userId);
  if (profile.brokenStreak && daysBetween(profile.brokenStreak.firstMissedDate, today) > STREAK_REPAIR_DAYS) {
    profile.brokenStreak = null;
    await profile.save();
  }
  const missed = missedDates(values(streak), today);
  if (missed.length) {
    const amulet = new Set<string>(profile.amuletSaturday ? [profile.amuletSaturday, addDays(profile.amuletSaturday, 1)] : []);
    const plan = planProtection(missed, profile.freezes, amulet);
    if (plan.coverable) {
      for (const p of plan.protect) {
        await ProtectedDay.updateOne({ userId, date: p.date }, { $setOnInsert: { source: p.source, createdAt: new Date() } }, { upsert: true });
        await celebrate(userId, p.source === 'amulet' ? 'amulet_used' : 'freeze_used', { date: p.date, streak: streak.currentDays }, `protect:${p.date}`);
      }
      profile.freezes -= plan.freezesUsed;
      await profile.save();
      streak.lastCoveredDate = addDays(today, -1);
      streak.updatedAt = new Date();
      await streak.save();
    } else {
      profile.brokenStreak = { days: streak.currentDays, lastCoveredDate: coveredThrough(values(streak))!, firstMissedDate: missed[0]! };
      if (profile.wager?.status === 'active') {
        profile.wager.status = 'lost';
        profile.wager.resolvedOn = today;
        await celebrate(userId, 'wager_lost', { stake: profile.wager.stake }, `wager_lost:${profile.wager.startedOn}`);
      }
      await profile.save();
      await celebrate(
        userId,
        'streak_broken',
        { days: streak.currentDays, repairable_until: addDays(missed[0]!, STREAK_REPAIR_DAYS) },
        `broken:${missed[0]}`,
      );
      // Zero so the same gap is not processed again; the count lives on in brokenStreak for a repair.
      streak.currentDays = 0;
      streak.updatedAt = new Date();
      await streak.save();
    }
  }
  await settleWager(userId, profile, coveredThrough(values(streak)), today);
  return { streak, profile };
}

/** Applies a newly credited study day: extends the streak, then milestones and wagers. */
export async function creditDay(userId: string, today: string) {
  const { streak, profile } = await syncStreak(userId, today);
  const before = streak.currentDays;
  const next = creditStreak(values(streak), today);
  if (!next.inserted) return streak;
  streak.currentDays = next.currentDays;
  streak.longestDays = next.longestDays;
  streak.lastStudyDate = next.lastStudyDate;
  streak.lastCoveredDate = next.lastCoveredDate ?? today;
  streak.updatedAt = new Date();
  await streak.save();
  for (const days of STREAK_MILESTONES) {
    if (before < days && next.currentDays >= days) {
      await celebrate(userId, 'streak_milestone', { days }, `milestone:${days}:${today}`);
      await awardAchievement(userId, `streak_${days}`);
    }
  }
  await settleWager(userId, profile, today, today);
  return streak;
}

/** Restores a broken streak by protecting the missed days, within the repair window. */
export async function repairStreak(userId: string, today: string) {
  const { streak, profile } = await syncStreak(userId, today);
  const broken = profile.brokenStreak;
  if (!broken) throw conflict('nothing_to_repair', 'There is no broken streak to repair');
  const after = await DailyStudyDay.find({ userId, studyDate: { $gt: broken.lastCoveredDate } }).select({ studyDate: 1 }).sort({ studyDate: 1 }).lean();
  // Missed days run up to the first study day after the break, or yesterday.
  const end = after.length ? addDays(after[0]!.studyDate, -1) : addDays(today, -1);
  for (let d = broken.firstMissedDate; daysBetween(d, end) >= 0; d = addDays(d, 1)) {
    await ProtectedDay.updateOne({ userId, date: d }, { $setOnInsert: { source: 'repair', createdAt: new Date() } }, { upsert: true });
  }
  // Study days since the break continue the restored streak while they are consecutive.
  let run = 0;
  let expected = after[0]?.studyDate;
  for (const day of after) {
    if (day.studyDate !== expected) break;
    run++;
    expected = addDays(day.studyDate, 1);
  }
  streak.currentDays = broken.days + run;
  streak.longestDays = Math.max(streak.longestDays, streak.currentDays);
  streak.lastCoveredDate = run ? addDays(after[0]!.studyDate, run - 1) : end;
  streak.updatedAt = new Date();
  await streak.save();
  profile.brokenStreak = null;
  await profile.save();
  await celebrate(userId, 'streak_repaired', { days: streak.currentDays }, `repaired:${broken.firstMissedDate}`);
  return streak;
}

/** The weekend an amulet bought today covers. */
export function amuletFor(today: string) {
  const [saturday, sunday] = amuletWeekend(today);
  return { saturday, sunday };
}
