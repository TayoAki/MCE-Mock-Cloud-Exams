import { Celebration, EngagementProfile, GemLedger } from '../models/index.js';
import { GEMS, PERFECT_BONUS_XP, levelFor } from '../lib/rules.js';
import { checkAchievements } from './achievements.js';
import { grantReward } from './grading.js';
import { recordLeagueXp, type LeagueStanding } from './leagues.js';
import { onStudyDay } from './friends.js';
import { xpTotal } from './progress.js';
import { refreshQuests, type QuestView } from './quests.js';
import { celebrate, earnGems, ensureProfile, toCelebration } from './wallet.js';

export interface EngagementSummary {
  accuracy: number;
  duration_seconds: number | null;
  gems_earned: number;
  gems_total: number;
  level: { level: number; title: string; xp: number; floor: number; next: number; leveled_up: boolean };
  quests: QuestView[];
  chest_available: boolean;
  league: LeagueStanding | null;
  celebrations: ReturnType<typeof toCelebration>[];
}

/**
 * Everything a finished session adds beyond grading and the streak: lesson
 * gems, the perfect-lesson bonus, quests, level, badges, league XP and friend
 * streaks. Runs inside the completion transaction, so a retried completion
 * returns the same stored summary and grants nothing twice.
 */
export async function afterCompletion(c: {
  userId: string;
  session: { _id: string; mode: string; lessonId?: string | null; enrollmentId: string; startedAt: Date; selectionConfig?: unknown };
  status: 'completed' | 'expired';
  correct: number;
  total: number;
  timezone: string;
  today: string;
  studyDayCredited: boolean;
  now: Date;
}): Promise<EngagementSummary> {
  const { userId, session, now } = c;
  const profile = await ensureProfile(userId);
  const lessonDone = c.status === 'completed' && !!session.lessonId && (session.mode === 'lesson' || session.mode === 'checkpoint');
  const lessonKey = `enrollment:${session.enrollmentId}:lesson:${session.lessonId}`;
  if (lessonDone) await earnGems(userId, GEMS.lessonComplete, 'lesson_complete', `${lessonKey}:gems`);
  // A story's gems come once per story, the first time it is finished.
  const storyId = (session.selectionConfig as { story_id?: string } | undefined)?.story_id;
  if (c.status === 'completed' && session.mode === 'story' && storyId) {
    await earnGems(userId, GEMS.storyComplete, 'story_complete', `enrollment:${session.enrollmentId}:story:${storyId}:gems`);
  }
  if (lessonDone && c.total >= 5 && c.correct === c.total) {
    await grantReward(userId, session._id, {
      amount: PERFECT_BONUS_XP,
      reasonCode: 'perfect_lesson',
      sourceType: 'session',
      sourceId: session._id,
      idempotencyKey: `${lessonKey}:perfect`,
    });
    await earnGems(userId, GEMS.perfectLesson, 'perfect_lesson', `${lessonKey}:perfect_gems`);
  }

  if (c.studyDayCredited) await onStudyDay(userId, c.today);
  const quests = await refreshQuests(userId, c.timezone, now);
  const league = await recordLeagueXp(userId, now);

  const xp = await xpTotal(userId);
  const level = levelFor(xp);
  const leveledUp = level.level > profile.level;
  if (leveledUp) {
    await EngagementProfile.updateOne({ _id: userId }, { $max: { level: level.level } });
    await celebrate(userId, 'level_up', { level: level.level, title: level.title }, `level:${level.level}`);
  }
  await checkAchievements(userId);

  const earned = await GemLedger.find({ userId, createdAt: { $gte: now }, amount: { $gt: 0 } }).select({ amount: 1 }).lean();
  const fresh = await Celebration.find({ userId, seenAt: null, createdAt: { $gte: now } }).sort({ createdAt: 1 }).lean();
  const elapsed = Math.round((now.getTime() - session.startedAt.getTime()) / 1000);
  return {
    accuracy: c.total ? Math.round((c.correct / c.total) * 100) : 0,
    // A session resumed hours later has no meaningful duration.
    duration_seconds: elapsed > 0 && elapsed < 3600 ? elapsed : null,
    gems_earned: earned.reduce((sum, g) => sum + g.amount, 0),
    gems_total: (await EngagementProfile.findById(userId).select({ gems: 1 }).lean())?.gems ?? 0,
    level: { level: level.level, title: level.title, xp, floor: level.floor, next: level.next, leveled_up: leveledUp },
    quests: quests.quests,
    chest_available: quests.chestAvailable,
    league,
    celebrations: fresh.map(toCelebration),
  };
}
