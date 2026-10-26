import {
  Achievement,
  Attempt,
  CircleMember,
  DailyQuestSet,
  Domain,
  Enrollment,
  FriendStreak,
  HighFive,
  PracticeSession,
  StreakState,
} from '../models/index.js';
import { GEMS, STREAK_MILESTONES, levelFor } from '../lib/rules.js';
import { xpTotal } from './progress.js';
import { celebrate, earnGems } from './wallet.js';

type Stat =
  | 'lessons'
  | 'perfect'
  | 'reviews'
  | 'mocks'
  | 'xp'
  | 'level'
  | 'quests'
  | 'chests'
  | 'circles'
  | 'friend_streak'
  | 'high_fives'
  | 'stories'
  | 'domains_all';

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  icon: string;
  group: 'habit' | 'learning' | 'practice' | 'social' | 'league';
  stat?: Stat;
  threshold?: number;
}

/** Badges reward effort and coverage, never readiness. */
export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_lesson', title: 'First steps', description: 'Finish your first lesson', icon: 'footsteps', group: 'learning', stat: 'lessons', threshold: 1 },
  { key: 'lessons_10', title: 'Getting serious', description: 'Finish 10 lessons', icon: 'school', group: 'learning', stat: 'lessons', threshold: 10 },
  { key: 'lessons_25', title: 'Pipeline in motion', description: 'Finish 25 lessons', icon: 'git-network', group: 'learning', stat: 'lessons', threshold: 25 },
  { key: 'lessons_50', title: 'Production ready', description: 'Finish 50 lessons', icon: 'rocket', group: 'learning', stat: 'lessons', threshold: 50 },
  { key: 'perfect_1', title: 'Flawless', description: 'Finish a lesson with no mistakes', icon: 'diamond', group: 'learning', stat: 'perfect', threshold: 1 },
  { key: 'perfect_10', title: 'Sharpshooter', description: 'Finish 10 lessons with no mistakes', icon: 'locate', group: 'learning', stat: 'perfect', threshold: 10 },
  { key: 'domains_all', title: 'Well rounded', description: 'Practice every exam domain', icon: 'grid', group: 'learning', stat: 'domains_all', threshold: 1 },
  { key: 'story_1', title: 'Storyteller', description: 'Finish a story', icon: 'book', group: 'learning', stat: 'stories', threshold: 1 },
  { key: 'stories_5', title: 'Page turner', description: 'Finish 5 stories', icon: 'library', group: 'learning', stat: 'stories', threshold: 5 },
  { key: 'reviews_10', title: 'Memory keeper', description: 'Complete 10 review sessions', icon: 'refresh-circle', group: 'practice', stat: 'reviews', threshold: 10 },
  { key: 'mock_1', title: 'Dress rehearsal', description: 'Finish a mock exam', icon: 'document-text', group: 'practice', stat: 'mocks', threshold: 1 },
  { key: 'mock_5', title: 'Exam-day calm', description: 'Finish 5 mock exams', icon: 'ribbon', group: 'practice', stat: 'mocks', threshold: 5 },
  { key: 'xp_1000', title: 'Thousand club', description: 'Earn 1,000 XP', icon: 'flash', group: 'practice', stat: 'xp', threshold: 1000 },
  { key: 'xp_5000', title: 'Power user', description: 'Earn 5,000 XP', icon: 'thunderstorm', group: 'practice', stat: 'xp', threshold: 5000 },
  { key: 'level_5', title: 'Level 5', description: 'Reach level 5', icon: 'trending-up', group: 'practice', stat: 'level', threshold: 5 },
  { key: 'level_10', title: 'Level 10', description: 'Reach level 10', icon: 'trophy', group: 'practice', stat: 'level', threshold: 10 },
  { key: 'quests_30', title: 'Quest seeker', description: 'Complete 30 daily quests', icon: 'compass', group: 'habit', stat: 'quests', threshold: 30 },
  { key: 'chests_10', title: 'Treasure hunter', description: 'Open 10 quest chests', icon: 'gift', group: 'habit', stat: 'chests', threshold: 10 },
  ...STREAK_MILESTONES.map(
    (days): AchievementDef => ({ key: `streak_${days}`, title: `${days}-day streak`, description: `Keep a ${days}-day streak`, icon: 'flame', group: 'habit' }),
  ),
  { key: 'circle_member', title: 'Better together', description: 'Join or create a study circle', icon: 'people', group: 'social', stat: 'circles', threshold: 1 },
  { key: 'friend_streak_7', title: 'Study buddies', description: 'Keep a 7-day friend streak', icon: 'heart', group: 'social', stat: 'friend_streak', threshold: 7 },
  { key: 'high_five_10', title: 'High-fiver', description: 'Give 10 high-fives', icon: 'hand-left', group: 'social', stat: 'high_fives', threshold: 10 },
  { key: 'league_promoted', title: 'Moving up', description: 'Get promoted in a league', icon: 'arrow-up-circle', group: 'league' },
  { key: 'league_top3', title: 'Podium', description: 'Finish a league week in the top 3', icon: 'medal', group: 'league' },
  { key: 'league_winner', title: 'Champion', description: 'Finish first in your league', icon: 'trophy', group: 'league' },
];

const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

/** Monthly challenge badges use dynamic keys like monthly_2026_10. */
export function monthlyBadge(month: string): AchievementDef {
  const [y, m] = month.split('-');
  const name = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key: `monthly_${y}_${m}`, title: `${name} challenge`, description: `Completed the ${name} quest challenge`, icon: 'calendar', group: 'habit' };
}

function defFor(key: string): AchievementDef | undefined {
  if (key.startsWith('monthly_')) return monthlyBadge(key.slice(8).replace('_', '-'));
  return BY_KEY.get(key);
}

/** Awards a badge once, with gems and a celebration. Returns true when newly earned. */
export async function awardAchievement(userId: string, key: string): Promise<boolean> {
  const def = defFor(key);
  if (!def) return false;
  const res = await Achievement.updateOne({ userId, key }, { $setOnInsert: { earnedAt: new Date() } }, { upsert: true });
  if (!res.upsertedCount) return false;
  const gems = await earnGems(userId, key.startsWith('monthly_') ? GEMS.monthlyChallenge : GEMS.achievement, 'achievement', `achievement:${key}`);
  await celebrate(userId, key.startsWith('monthly_') ? 'monthly_challenge' : 'achievement', { key, title: def.title, description: def.description, icon: def.icon, gems }, `achievement:${key}`);
  return true;
}

async function stats(userId: string): Promise<Record<Stat, number>> {
  const finished = { userId, status: { $in: ['completed', 'expired'] as ('completed' | 'expired')[] } };
  const lessons = await PracticeSession.countDocuments({ ...finished, status: 'completed', mode: { $in: ['lesson', 'checkpoint'] } });
  const perfect = await PracticeSession.countDocuments({
    ...finished,
    status: 'completed',
    mode: { $in: ['lesson', 'checkpoint'] },
    'completion.total': { $gte: 5 },
    $expr: { $eq: ['$completion.correct', '$completion.total'] },
  });
  const reviews = await PracticeSession.countDocuments({ ...finished, mode: 'review' });
  const mocks = await PracticeSession.countDocuments({ ...finished, mode: 'mock' });
  const stories = (await PracticeSession.distinct('selectionConfig.story_id', { userId, status: 'completed', mode: 'story' })).length;
  const xp = await xpTotal(userId);
  const quests = await DailyQuestSet.aggregate<{ n: number }>([
    { $match: { userId } },
    { $unwind: '$quests' },
    { $match: { 'quests.completedAt': { $ne: null } } },
    { $count: 'n' },
  ]);
  const chests = await DailyQuestSet.countDocuments({ userId, chestOpenedAt: { $ne: null } });
  const circles = await CircleMember.countDocuments({ userId, status: 'active' });
  const friend = await FriendStreak.find({ pair: userId }).select({ longestDays: 1 }).lean();
  const highFives = await HighFive.countDocuments({ fromId: userId, kind: 'high_five' });
  let domainsAll = 0;
  for (const e of await Enrollment.find({ userId }).select({ examVersionId: 1 }).lean()) {
    const total = await Domain.countDocuments({ examVersionId: e.examVersionId });
    const practiced = (await Attempt.distinct('domainId', { userId, examVersionId: e.examVersionId })).length;
    if (total > 0 && practiced >= total) domainsAll = 1;
  }
  return {
    lessons,
    perfect,
    reviews,
    mocks,
    xp,
    level: levelFor(xp).level,
    quests: quests[0]?.n ?? 0,
    chests,
    circles,
    friend_streak: Math.max(0, ...friend.map((f) => f.longestDays)),
    high_fives: highFives,
    stories,
    domains_all: domainsAll,
  };
}

/** Checks every stat-based badge and awards the ones newly reached. Returns the new keys. */
export async function checkAchievements(userId: string): Promise<string[]> {
  const earned = new Set((await Achievement.find({ userId }).select({ key: 1 }).lean()).map((a) => a.key));
  const s = await stats(userId);
  const longest = (await StreakState.findById(userId).select({ longestDays: 1 }).lean())?.longestDays ?? 0;
  const fresh: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (earned.has(def.key)) continue;
    const reached = def.stat ? s[def.stat] >= (def.threshold ?? 1) : def.key.startsWith('streak_') && longest >= Number(def.key.slice(7));
    if (reached && (await awardAchievement(userId, def.key))) fresh.push(def.key);
  }
  return fresh;
}

export async function achievementsView(userId: string) {
  const rows = await Achievement.find({ userId }).sort({ earnedAt: 1 }).lean();
  const earned = new Map(rows.map((r) => [r.key, r.earnedAt.toISOString()]));
  return {
    badges: ACHIEVEMENTS.map((a) => ({ key: a.key, title: a.title, description: a.description, icon: a.icon, group: a.group, earned_at: earned.get(a.key) ?? null })),
    monthly: rows.filter((r) => r.key.startsWith('monthly_')).map((r) => ({ ...monthlyBadge(r.key.slice(8).replace('_', '-')), earned_at: r.earnedAt.toISOString() })),
  };
}
