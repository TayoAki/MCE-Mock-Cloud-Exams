import { Attempt } from '../models/index.js';
import { PEER_MIN_SAMPLE } from '../lib/rules.js';

export interface PeerStat {
  /** Share of learners who answered right on their first try; null until enough have answered. */
  correct_percent: number | null;
  answered: number;
}

/**
 * First-try accuracy per question family across all learners. Each learner's
 * first graded answer to a family counts once; answers to invalidated revisions don't.
 */
export async function peerStats(familyIds: string[]): Promise<Map<string, PeerStat>> {
  const ids = [...new Set(familyIds)];
  if (ids.length === 0) return new Map();
  const rows = await Attempt.aggregate<{ _id: string; n: number; correct: number }>([
    { $match: { familyId: { $in: ids }, firstSeenFamily: true, invalidatedAt: null } },
    { $group: { _id: '$familyId', n: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } } } },
  ]);
  const byFamily = new Map(rows.map((r) => [r._id, r]));
  return new Map(
    ids.map((id) => {
      const r = byFamily.get(id);
      const n = r?.n ?? 0;
      return [id, { answered: n, correct_percent: n >= PEER_MIN_SAMPLE ? Math.round((r!.correct / n) * 100) : null }];
    }),
  );
}
