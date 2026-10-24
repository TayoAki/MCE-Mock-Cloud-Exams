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
}

/** Same date: unchanged. Adjacent date: +1. Gap: restart at 1. Longest never decreases. */
export function creditStreak(state: StreakState, day: string): StreakState & { inserted: boolean } {
  const gap = state.lastStudyDate ? daysBetween(state.lastStudyDate, day) : null;
  if (gap !== null && gap < 0) throw new Error('Historical credit needs a repair workflow');
  if (gap === 0) return { ...state, inserted: false };
  const current = gap === 1 ? state.currentDays + 1 : 1;
  return { lastStudyDate: day, currentDays: current, longestDays: Math.max(state.longestDays, current), inserted: true };
}

/** A streak is shown as broken once a full local day has passed without credit. */
export function displayedStreak(state: StreakState, today: string): number {
  if (!state.lastStudyDate) return 0;
  return daysBetween(state.lastStudyDate, today) <= 1 ? state.currentDays : 0;
}

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
