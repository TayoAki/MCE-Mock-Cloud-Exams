import { Attempt, Domain, FlaggedQuestion, Objective, PracticeSession, QuestionVersion } from '../models/index.js';
import { track } from '../lib/analytics.js';
import { badRequest, notFound } from '../lib/errors.js';
import { latestPublishedByFamily, loadQuestionVersions } from './content.js';
import { ownedEnrollment } from './progress.js';

/** Flags a question the learner has been shown. Flags follow the family, so a revised question stays flagged. */
export async function flagQuestion(userId: string, familyId: string, questionVersionId: string) {
  const question = await QuestionVersion.findOne({ _id: questionVersionId, familyId }).select({ examVersionId: 1, storyId: 1 }).lean();
  if (!question) throw notFound('Question');
  // Only questions from the learner's own sessions; this also keeps drafts private.
  const seen = await PracticeSession.exists({ userId, 'items.questionVersionId': questionVersionId });
  if (!seen) throw notFound('Question');
  if (question.storyId) throw badRequest('story_question', 'Story questions belong to their story and can’t be flagged');
  await FlaggedQuestion.updateOne(
    { userId, familyId },
    { $set: { questionVersionId, examVersionId: question.examVersionId }, $setOnInsert: { flaggedAt: new Date() } },
    { upsert: true },
  );
  track('question_flagged', { userId, examVersionId: question.examVersionId, properties: { flagged: true } });
  return { family_id: familyId, flagged: true };
}

export async function unflagQuestion(userId: string, familyId: string) {
  const removed = await FlaggedQuestion.findOneAndDelete({ userId, familyId }).lean();
  if (removed) track('question_flagged', { userId, examVersionId: removed.examVersionId, properties: { flagged: false } });
  return { family_id: familyId, flagged: false };
}

export async function flaggedFamilies(userId: string, familyIds: string[]) {
  if (familyIds.length === 0) return new Set<string>();
  const rows = await FlaggedQuestion.find({ userId, familyId: { $in: familyIds } }).select({ familyId: 1 }).lean();
  return new Set(rows.map((r) => r.familyId));
}

/** The learner's flagged questions for an enrollment, newest first, with their latest result. */
export async function listFlags(userId: string, enrollmentId: string) {
  const enrollment = await ownedEnrollment(userId, enrollmentId);
  const flags = await FlaggedQuestion.find({ userId, examVersionId: enrollment.examVersionId }).sort({ flaggedAt: -1 }).lean();
  const familyIds = flags.map((f) => f.familyId);
  const published = await latestPublishedByFamily(enrollment.examVersionId, familyIds);
  // A family with no published revision (retired or under repair) shows the revision that was flagged.
  const fallback = new Map((await loadQuestionVersions(flags.filter((f) => !published.has(f.familyId)).map((f) => f.questionVersionId))).map((q) => [q.familyId, q]));
  const latest = await Attempt.aggregate<{ _id: string; isCorrect: boolean }>([
    { $match: { userId, familyId: { $in: familyIds }, gradedAt: { $ne: null }, invalidatedAt: null } },
    { $sort: { gradedAt: -1 } },
    { $group: { _id: '$familyId', isCorrect: { $first: '$isCorrect' } } },
  ]);
  const lastResult = new Map(latest.map((l) => [l._id, l.isCorrect]));
  const questions = flags.map((f) => published.get(f.familyId) ?? fallback.get(f.familyId)).filter((q) => !!q);
  const [objectives, domains] = await Promise.all([
    Objective.find({ _id: { $in: questions.map((q) => q.objectiveId) } }).select({ title: 1 }).lean(),
    Domain.find({ _id: { $in: questions.map((q) => q.domainId) } }).select({ title: 1 }).lean(),
  ]);
  const objectiveTitles = new Map(objectives.map((o) => [o._id, o.title]));
  const domainTitles = new Map(domains.map((d) => [d._id, d.title]));
  const items = flags.flatMap((f) => {
    const q = published.get(f.familyId) ?? fallback.get(f.familyId);
    if (!q) return [];
    return [
      {
        family_id: f.familyId,
        question_version_id: q._id,
        prompt: q.prompt,
        answer_type: q.answerType,
        objective_title: objectiveTitles.get(q.objectiveId) ?? '',
        domain_title: domainTitles.get(q.domainId) ?? '',
        flagged_at: f.flaggedAt.toISOString(),
        last_correct: lastResult.get(f.familyId) ?? null,
        available: published.has(f.familyId),
      },
    ];
  });
  return { enrollment_id: enrollmentId, items, quiz_available: items.filter((i) => i.available).length };
}
