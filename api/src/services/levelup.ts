import { Domain, LevelUpProgress } from '../models/index.js';
import { GEMS, MAX_LEVEL, levelLabel, levelPassNeeded } from '../lib/rules.js';
import { familyDifficulty, latestPublishedByFamily, loadBlueprint } from './content.js';
import { ownedEnrollment } from './progress.js';
import { practicePool } from './selection.js';
import { celebrate, earnGems } from './wallet.js';

export interface LevelUpResult {
  domain_id: string;
  domain_title: string;
  level: number;
  label: string;
  passed: boolean;
  newly_passed: boolean;
  correct: number;
  total: number;
  needed: number;
  next_level: { level: number; label: string } | null;
  mastered: boolean;
}

/** Every domain's level, label and question counts per difficulty, for the Level Up screen. */
export async function levelUpOverview(userId: string, enrollmentId: string) {
  const enrollment = await ownedEnrollment(userId, enrollmentId);
  const { domains } = await loadBlueprint(enrollment.examVersionId);
  const [all, pool, progress] = await Promise.all([
    latestPublishedByFamily(enrollment.examVersionId),
    practicePool(userId, enrollment),
    LevelUpProgress.find({ enrollmentId }).lean(),
  ]);
  const difficulty = await familyDifficulty([...all.keys()]);
  const byDomain = new Map(progress.map((p) => [p.domainId, p]));
  return {
    enrollment_id: enrollmentId,
    levels: Array.from({ length: MAX_LEVEL }, (_, i) => ({ level: i + 1, label: levelLabel(i + 1) })),
    domains: domains.map((d) => {
      const p = byDomain.get(d._id);
      const passed = p?.levelPassed ?? 0;
      // On the free plan (when Plus is on) a domain opens once the path reaches it.
      const questions = pool.filter((q) => q.domainId === d._id);
      const counts = [1, 2, 3].map((n) => questions.filter((q) => difficulty.get(q.familyId) === n).length);
      const level = Math.min(passed + 1, MAX_LEVEL);
      return {
        domain_id: d._id,
        title: d.title,
        weight_percent: d.weightPercent,
        level_passed: passed,
        current_level: level,
        label: levelLabel(level),
        mastered: passed >= MAX_LEVEL,
        question_count: questions.length,
        available: questions.length > 0,
        locked: questions.length === 0 && [...all.values()].some((q) => q.domainId === d._id),
        by_difficulty: counts,
        best: (p?.best ?? {}) as Record<string, number>,
        attempts: p?.attempts ?? 0,
      };
    }),
  };
}

/**
 * Records a finished Level Up session. Passing the learner's current level
 * unlocks the next one, once, with gems and a celebration. Runs inside the
 * completion transaction.
 */
export async function applyLevelUp(c: {
  userId: string;
  enrollmentId: string;
  config: { domain_id?: string; level?: number };
  status: 'completed' | 'expired';
  correct: number;
  total: number;
  now: Date;
}): Promise<LevelUpResult | null> {
  const { domain_id: domainId, level } = c.config;
  if (!domainId || !level) return null;
  const domain = await Domain.findById(domainId).select({ title: 1 }).lean();
  const needed = levelPassNeeded(c.total);
  const passed = c.status === 'completed' && c.correct >= needed;
  const before = await LevelUpProgress.findOneAndUpdate(
    { enrollmentId: c.enrollmentId, domainId },
    {
      $setOnInsert: { userId: c.userId },
      $inc: { attempts: 1 },
      $max: { [`best.${level}`]: c.correct, ...(passed ? { levelPassed: level } : {}) },
      $set: { updatedAt: c.now },
    },
    { upsert: true, returnDocument: 'before' },
  ).lean();
  const newlyPassed = passed && (before?.levelPassed ?? 0) < level;
  const passedNow = Math.max(before?.levelPassed ?? 0, passed ? level : 0);
  const domainTitle = domain?.title ?? '';
  if (newlyPassed) {
    const key = `levelup:${c.enrollmentId}:${domainId}:${level}`;
    await earnGems(c.userId, GEMS.levelUp, 'level_up', key);
    await celebrate(
      c.userId,
      'levelup_passed',
      { domain_title: domainTitle, level, label: levelLabel(level), mastered: level >= MAX_LEVEL, gems: GEMS.levelUp },
      key,
    );
  }
  const nextLevel = passedNow < MAX_LEVEL ? passedNow + 1 : null;
  return {
    domain_id: domainId,
    domain_title: domainTitle,
    level,
    label: levelLabel(level),
    passed,
    newly_passed: newlyPassed,
    correct: c.correct,
    total: c.total,
    needed,
    next_level: nextLevel ? { level: nextLevel, label: levelLabel(nextLevel) } : null,
    mastered: passedNow >= MAX_LEVEL,
  };
}
