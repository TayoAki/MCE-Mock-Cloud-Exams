/**
 * Learning, reward and habit rules from delivery/RETENTION_AND_LEARNING_RULES.md.
 * Every number is an initial hypothesis; keep them here so they are tuned in one place.
 */
import { addDays, daysBetween } from './time.js';

export const XP = {
  newAttempt: 10,
  firstCorrect: 5,
  lessonComplete: 10,
  reviewRepeat: 2,
} as const;

/** A study day requires a server-finalized session with this many submitted items. */
export const QUALIFYING_ITEMS = 5;
/** Minimum first-seen attempts before an objective is ranked by accuracy. */
export const MIN_RANKING_SAMPLE = 5;
export const PREVIEW_DAYS = 14;
export const SAMPLE_MOCK_SIZE = 10;
export const PLUS_FEATURES = ['full_bank', 'custom_quiz', 'mocks', 'ai_explain'] as const;
export type FeatureKey = (typeof PLUS_FEATURES)[number];

export const PRACTICE_SCORE_NOTE = 'Practice score; not a pass prediction.' as const;

export interface StreakState {
  lastStudyDate: string | null;
  currentDays: number;
  longestDays: number;
  /**
   * The latest date the streak is continuous through: a study day or a day a
   * freeze, the weekend amulet or a repair protected. Protected days keep the
   * streak alive but never count as study days.
   */
  lastCoveredDate?: string | null;
}

/** The later of the last study day and the last protected day. */
export function coveredThrough(state: StreakState): string | null {
  const { lastStudyDate, lastCoveredDate } = state;
  if (!lastCoveredDate) return lastStudyDate;
  if (!lastStudyDate) return lastCoveredDate;
  return daysBetween(lastStudyDate, lastCoveredDate) > 0 ? lastCoveredDate : lastStudyDate;
}

/** Same date: unchanged. Adjacent to the covered date: +1. Gap: restart at 1. Longest never decreases. */
export function creditStreak(state: StreakState, day: string): StreakState & { inserted: boolean } {
  if (state.lastStudyDate && daysBetween(state.lastStudyDate, day) < 0) throw new Error('Historical credit needs a repair workflow');
  if (state.lastStudyDate === day) return { ...state, inserted: false };
  const covered = coveredThrough(state);
  const gap = covered ? daysBetween(covered, day) : null;
  const current = gap === 1 ? state.currentDays + 1 : 1;
  return { lastStudyDate: day, lastCoveredDate: day, currentDays: current, longestDays: Math.max(state.longestDays, current), inserted: true };
}

/** A streak is shown as broken once a full local day has passed without credit or protection. */
export function displayedStreak(state: StreakState, today: string): number {
  const covered = coveredThrough(state);
  if (!covered) return 0;
  return daysBetween(covered, today) <= 1 ? state.currentDays : 0;
}

/** Days after the covered date and before today: the ones a freeze or amulet would have to protect. */
export function missedDates(state: StreakState, today: string): string[] {
  const covered = coveredThrough(state);
  if (!covered || state.currentDays === 0) return [];
  const gap = daysBetween(covered, today);
  return Array.from({ length: Math.max(0, gap - 1) }, (_, i) => addDays(covered, i + 1));
}

/**
 * Decides how missed days are protected. Amulet days are covered first, then
 * one freeze per remaining day. Freezes are only spent when every missed day
 * can be covered; otherwise the streak breaks and the freezes are kept.
 */
export function planProtection(missed: string[], freezes: number, amuletDates: ReadonlySet<string>) {
  const amulet = missed.filter((d) => amuletDates.has(d));
  const needFreeze = missed.filter((d) => !amuletDates.has(d));
  if (needFreeze.length > freezes) return { coverable: false as const, protect: [] as { date: string; source: 'amulet' | 'freeze' }[], freezesUsed: 0 };
  return {
    coverable: true as const,
    protect: [...amulet.map((date) => ({ date, source: 'amulet' as const })), ...needFreeze.map((date) => ({ date, source: 'freeze' as const }))].sort((a, b) =>
      a.date < b.date ? -1 : 1,
    ),
    freezesUsed: needFreeze.length,
  };
}

/** The Saturday and Sunday a weekend amulet bought on `today` protects: this weekend from Saturday, otherwise the next one. */
export function amuletWeekend(today: string): [string, string] {
  // 2024-01-06 was a Saturday; count days from it to find today's weekday.
  const weekday = ((daysBetween('2024-01-06', today) % 7) + 7) % 7; // 0 = Saturday … 6 = Friday
  const saturday = weekday === 0 ? today : addDays(today, 7 - weekday);
  return [saturday, addDays(saturday, 1)];
}

// ---- Engagement: levels, gems, shop, quests, streak extras, leagues -------------------------

/** Cumulative XP to reach a level: 0, 50, 150, 300, 500, 750 … (25·(L−1)·L). */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : 25 * (level - 1) * level;
}

const LEVEL_TITLES: [number, string][] = [
  [1, 'Intern'],
  [3, 'Pipeline Builder'],
  [5, 'Data Wrangler'],
  [8, 'Lakehouse Engineer'],
  [12, 'Delta Architect'],
  [18, 'Data Legend'],
];

export function levelFor(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const title = [...LEVEL_TITLES].reverse().find(([min]) => level >= min)![1];
  return { level, title, floor: xpForLevel(level), next: xpForLevel(level + 1) };
}

/** Gems are earned only (CertPath sells nothing); they buy streak protection. */
export const GEMS = {
  lessonComplete: 5,
  perfectLesson: 5,
  achievement: 20,
  monthlyChallenge: 100,
  circleQuest: 30,
  /** League finish rewards for ranks 1, 2 and 3. */
  leagueRank: [60, 40, 25],
  wagerStake: 50,
  wagerPayout: 100,
} as const;

export const SHOP_PRICES = { streak_freeze: 200, weekend_amulet: 150, streak_repair: 350, streak_wager: GEMS.wagerStake } as const;
export type ShopItem = keyof typeof SHOP_PRICES;
export const MAX_FREEZES = 2;
/** A broken streak can be repaired up to this many days after the first missed day. */
export const STREAK_REPAIR_DAYS = 3;
export const WAGER_DAYS = 7;
export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365] as const;
export const PERFECT_BONUS_XP = 5;
export const BOOST = { multiplier: 2, minutes: 15 } as const;

export type QuestMetric = 'answers' | 'correct' | 'xp' | 'best_run' | 'lessons' | 'perfect' | 'sessions';
interface QuestTemplate {
  key: string;
  metric: QuestMetric;
  /** Easy, medium, hard slot. One quest per slot each day. */
  slot: 0 | 1 | 2;
  /** Targets for 5-, 10- and 15-minute daily goals. */
  targets: [number, number, number];
  label: (n: number) => string;
}

export const QUEST_TEMPLATES: QuestTemplate[] = [
  { key: 'answers', metric: 'answers', slot: 0, targets: [10, 15, 20], label: (n) => `Answer ${n} questions` },
  { key: 'correct', metric: 'correct', slot: 0, targets: [5, 8, 12], label: (n) => `Get ${n} answers right` },
  { key: 'xp', metric: 'xp', slot: 1, targets: [40, 60, 100], label: (n) => `Earn ${n} XP` },
  { key: 'run', metric: 'best_run', slot: 1, targets: [3, 4, 5], label: (n) => `Get ${n} right in a row` },
  { key: 'lessons', metric: 'lessons', slot: 2, targets: [1, 2, 3], label: (n) => (n === 1 ? 'Finish a lesson' : `Finish ${n} lessons`) },
  { key: 'perfect', metric: 'perfect', slot: 2, targets: [1, 1, 1], label: () => 'Finish a lesson with no mistakes' },
  { key: 'sessions', metric: 'sessions', slot: 2, targets: [2, 3, 4], label: (n) => `Complete ${n} practice sessions` },
];
export const MONTHLY_QUEST_TARGET = 30;

/** Weighted chest contents; a freeze falls back to gems when the learner already holds the maximum. */
export const CHEST_TABLE = [
  { weight: 40, reward: { kind: 'gems', amount: 15 } },
  { weight: 25, reward: { kind: 'gems', amount: 25 } },
  { weight: 10, reward: { kind: 'gems', amount: 40 } },
  { weight: 15, reward: { kind: 'xp_boost', minutes: BOOST.minutes } },
  { weight: 10, reward: { kind: 'streak_freeze' } },
] as const;

/** League tiers in order. The medallion names nod to Delta Lake's bronze, silver and gold layers. */
export const LEAGUE_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'lakehouse'] as const;
export type LeagueTier = (typeof LEAGUE_TIERS)[number];
export const LEAGUE_COHORT_SIZE = 30;

/** Promotion and demotion counts for a closed cohort; nobody moves on zero XP. */
export function leagueZones(size: number, tierIndex: number) {
  const top = tierIndex < LEAGUE_TIERS.length - 1 ? (size >= 2 ? Math.min(7, Math.max(1, Math.round(size * 0.2))) : 1) : 0;
  const bottom = tierIndex > 0 && size >= 5 ? Math.min(5, Math.floor(size * 0.15)) : 0;
  return { promote: top, demote: bottom };
}
/** A learner alone in a cohort still moves up after a solid week. */
export const SOLO_PROMOTION_XP = 100;
export const MAX_FRIEND_STREAKS = 5;

const REVIEW_INTERVALS = [1, 3, 7, 14] as const;
export const MAX_REVIEW_STAGE = 4;

/** Correct advances one stage (1, 3, 7, 14 days); wrong returns to stage 0, due tomorrow. */
export function nextReview(stage: number, correct: boolean, localDay: string) {
  const next = correct ? Math.min(stage + 1, MAX_REVIEW_STAGE) : 0;
  const days = correct ? REVIEW_INTERVALS[Math.min(stage, 3)]! : 1;
  return { stage: next, dueLocalDate: addDays(localDay, days) };
}

/**
 * Largest-remainder allocation of a form across domain weights. Ties go to the
 * later domain in guide order so allocation is deterministic.
 */
export function allocateBlueprint(count: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 1e-6) throw new Error('Weights must total 100');
  const raw = weights.map((w) => (w * count) / 100);
  const out = raw.map(Math.floor);
  const remaining = count - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, fraction: v - out[i]! }))
    .sort((a, b) => b.fraction - a.fraction || b.i - a.i);
  for (let k = 0; k < remaining; k++) out[order[k]!.i]!++;
  return out;
}
