import { Attempt, PracticeSession, QuestionRating, QuestionVersion } from '../models/index.js';
import { track } from '../lib/analytics.js';
import { badRequest, notFound } from '../lib/errors.js';
import { RATING_ATTENTION, RATING_MIN_SAMPLE } from '../lib/rules.js';
import { DELAYED_FEEDBACK_MODES } from './grading.js';

export interface RatingView {
  /** The learner's own stars, or null if they haven't rated it. */
  mine: number | null;
  /** The average across learners, to one decimal; null until enough have rated. */
  average: number | null;
  count: number;
}

/** Average stars and rating count per family. */
export async function ratingStats(familyIds: string[]) {
  const ids = [...new Set(familyIds)];
  if (ids.length === 0) return new Map<string, { average: number; count: number; distribution: number[] }>();
  const rows = await QuestionRating.aggregate<{ _id: string; count: number; total: number; stars: number[] }>([
    { $match: { familyId: { $in: ids } } },
    { $group: { _id: '$familyId', count: { $sum: 1 }, total: { $sum: '$stars' }, stars: { $push: '$stars' } } },
  ]);
  return new Map(
    rows.map((r) => [
      r._id,
      { average: Math.round((r.total / r.count) * 10) / 10, count: r.count, distribution: [1, 2, 3, 4, 5].map((n) => r.stars.filter((s) => s === n).length) },
    ]),
  );
}

/** What a learner sees for each family: their own rating and, once enough learners rated, the average. */
export async function ratingViews(userId: string, familyIds: string[]): Promise<Map<string, RatingView>> {
  const ids = [...new Set(familyIds)];
  if (ids.length === 0) return new Map();
  const [stats, mine] = await Promise.all([
    ratingStats(ids),
    QuestionRating.find({ userId, familyId: { $in: ids } }).select({ familyId: 1, stars: 1 }).lean(),
  ]);
  const own = new Map(mine.map((r) => [r.familyId, r.stars]));
  return new Map(
    ids.map((id) => {
      const s = stats.get(id);
      const count = s?.count ?? 0;
      return [id, { mine: own.get(id) ?? null, average: count >= RATING_MIN_SAMPLE ? s!.average : null, count }];
    }),
  );
}

/**
 * Rates a question the learner has answered and seen the answer to: mock answers
 * count only once the mock is submitted. Rating again replaces the earlier stars.
 */
export async function rateQuestion(userId: string, familyId: string, input: { question_version_id: string; stars: number }) {
  const question = await QuestionVersion.findOne({ _id: input.question_version_id, familyId }).select({ examVersionId: 1 }).lean();
  if (!question) throw notFound('Question');
  const attempts = await Attempt.find({ userId, familyId, gradedAt: { $ne: null } }).select({ mode: 1, sessionId: 1 }).lean();
  let revealed = attempts.some((a) => !DELAYED_FEEDBACK_MODES.has(a.mode));
  if (!revealed && attempts.length) {
    revealed = !!(await PracticeSession.exists({ _id: { $in: attempts.map((a) => a.sessionId) }, status: { $ne: 'active' } }));
  }
  if (!revealed) throw badRequest('not_answered', 'Answer this question and see its explanation before rating it');
  await QuestionRating.updateOne(
    { userId, familyId },
    { $set: { stars: input.stars, questionVersionId: input.question_version_id, examVersionId: question.examVersionId, ratedAt: new Date() } },
    { upsert: true },
  );
  track('question_rated', { userId, examVersionId: question.examVersionId, properties: { stars: input.stars } });
  return { family_id: familyId, ...(await ratingViews(userId, [familyId])).get(familyId)! };
}

export async function clearRating(userId: string, familyId: string) {
  await QuestionRating.deleteOne({ userId, familyId });
  return { family_id: familyId, ...(await ratingViews(userId, [familyId])).get(familyId)! };
}

/** Families learners rate poorly enough for staff to look at first: a low average from several learners. */
export async function lowRatedFamilies(examVersionId?: string) {
  const rows = await QuestionRating.aggregate<{ _id: string }>([
    { $match: examVersionId ? { examVersionId } : {} },
    { $group: { _id: '$familyId', count: { $sum: 1 }, average: { $avg: '$stars' } } },
    { $match: { count: { $gte: RATING_ATTENTION.minCount }, average: { $lte: RATING_ATTENTION.maxAverage } } },
  ]);
  return rows.map((r) => r._id);
}
