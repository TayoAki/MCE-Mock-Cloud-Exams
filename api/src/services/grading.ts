import { tx } from '../db.js';
import {
  Attempt,
  EngagementProfile,
  ObjectiveProgress,
  PracticeSession,
  QuestionExposure,
  QuestionKey,
  QuestionVersion,
  ReviewQueue,
  RewardLedger,
  User,
} from '../models/index.js';
import { track } from '../lib/analytics.js';
import { canonicalAnswer, gradeAnswer, sameAnswer } from '../lib/answers.js';
import type { AnswerType } from '../models/bank.js';
import { HttpError, badRequest, conflict, isDuplicateKey, notFound } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
import { BOOST, XP, nextReview } from '../lib/rules.js';
import { effectiveTimezone, localDate, startOfLocalDay } from '../lib/time.js';
import { peerStats, type PeerStat } from './peer.js';
import { ratingViews, type RatingView } from './ratings.js';

/** Feedback is withheld for these modes until the session is finalized. */
export const DELAYED_FEEDBACK_MODES = new Set(['mock']);

export interface Feedback {
  correct: boolean;
  /** Choices, the correct sequence for order questions, or "A=2" pairs for match. */
  correct_options: string[];
  /** The model answer for typed questions. */
  expected_answer: string | null;
  rationale: string;
  sources: string[];
}

export function buildFeedback(
  isCorrect: boolean,
  key: { correctOptions: string[]; acceptedAnswers?: string[] | null; rationale: string },
  sourceUrl: string,
  answerType: AnswerType = 'single',
): Feedback {
  return {
    correct: isCorrect,
    correct_options: answerType === 'order' ? [...key.correctOptions] : [...key.correctOptions].sort(),
    expected_answer: answerType === 'type' ? (key.acceptedAnswers?.[0] ?? null) : null,
    rationale: key.rationale,
    sources: [sourceUrl],
  };
}

/** Exact-set match for multi-select; a single answer must equal the one key. */
export function gradeSelection(selected: string[], correct: string[]): boolean {
  const a = new Set(selected);
  const b = new Set(correct);
  return a.size === b.size && [...a].every((k) => b.has(k));
}

type AttemptDoc = InstanceType<typeof Attempt>;

/** Inserts a reward once per idempotency key. Returns the XP actually granted. */
async function grant(
  userId: string,
  sessionId: string,
  reward: { amount: number; reasonCode: string; sourceType: string; sourceId: string; idempotencyKey: string },
): Promise<number> {
  const res = await RewardLedger.updateOne(
    { userId, idempotencyKey: reward.idempotencyKey },
    { $setOnInsert: { _id: uuid(), userId, sessionId, rewardType: 'xp', createdAt: new Date(), ...reward } },
    { upsert: true },
  );
  return res.upsertedCount ? reward.amount : 0;
}

export { grant as grantReward };

/**
 * Applies everything a graded answer changes: exposure, objective counters,
 * the review schedule and rewards. Must run inside a transaction.
 */
export async function applyGradedAttempt(
  attempt: AttemptDoc,
  isCorrect: boolean,
  ctx: { timezone: string; now: Date; sessionMode: string },
) {
  const { now, timezone } = ctx;
  const before = await QuestionExposure.findOneAndUpdate(
    { userId: attempt.userId, familyId: attempt.familyId },
    {
      $setOnInsert: { firstSeenAt: now, examVersionId: attempt.examVersionId, objectiveId: attempt.objectiveId },
      $set: { lastSeenAt: now },
      $inc: { answeredCount: 1 },
    },
    { upsert: true, returnDocument: 'before' },
  ).lean();
  const firstSeen = before === null;

  attempt.gradedAt = now;
  attempt.isCorrect = isCorrect;
  attempt.firstSeenFamily = firstSeen;
  await attempt.save();

  await ObjectiveProgress.updateOne(
    { enrollmentId: attempt.enrollmentId, objectiveId: attempt.objectiveId },
    {
      $setOnInsert: { userId: attempt.userId, examVersionId: attempt.examVersionId },
      $inc: {
        totalAttempts: 1,
        totalCorrect: isCorrect ? 1 : 0,
        firstSeenTotal: firstSeen ? 1 : 0,
        firstSeenCorrect: firstSeen && isCorrect ? 1 : 0,
      },
      $set: { lastPracticedAt: now },
    },
    { upsert: true },
  );

  // Review: a miss returns the concept to stage 0, due tomorrow (learner-local).
  // A correct answer on a due concept advances exactly one stage.
  const today = localDate(now, timezone);
  const entry = await ReviewQueue.findOne({ enrollmentId: attempt.enrollmentId, objectiveId: attempt.objectiveId });
  let scheduledStage: number | null = null;
  if (!isCorrect || (entry && entry.dueAt <= now)) {
    const priorStage = entry?.stage ?? 0;
    const next = nextReview(priorStage, isCorrect, today);
    const dueAt = startOfLocalDay(next.dueLocalDate, timezone);
    await ReviewQueue.updateOne(
      { enrollmentId: attempt.enrollmentId, objectiveId: attempt.objectiveId },
      {
        $setOnInsert: { _id: uuid(), userId: attempt.userId, examVersionId: attempt.examVersionId },
        $set: {
          stage: next.stage,
          dueAt,
          lastReviewedAt: now,
          ...(isCorrect ? {} : { reason: 'missed', sourceAttemptId: attempt._id }),
        },
        $push: {
          history: {
            $each: [{ at: now, priorStage, correct: isCorrect, familyId: attempt.familyId, attemptId: attempt._id, nextStage: next.stage, nextDueAt: dueAt }],
            $slice: -50,
          },
        },
      },
      { upsert: true },
    );
    scheduledStage = next.stage;
  }

  let xp = 0;
  if (firstSeen) {
    xp += await grant(attempt.userId, attempt.sessionId, {
      amount: XP.newAttempt,
      reasonCode: 'new_attempt',
      sourceType: 'attempt',
      sourceId: attempt._id,
      idempotencyKey: `attempt:${attempt._id}:new`,
    });
    if (isCorrect) {
      xp += await grant(attempt.userId, attempt.sessionId, {
        amount: XP.firstCorrect,
        reasonCode: 'first_correct',
        sourceType: 'attempt',
        sourceId: attempt._id,
        idempotencyKey: `attempt:${attempt._id}:correct`,
      });
    }
  } else if (ctx.sessionMode === 'review') {
    // Scheduled repeats earn a little, once per family per local day; replays earn nothing.
    xp += await grant(attempt.userId, attempt.sessionId, {
      amount: XP.reviewRepeat,
      reasonCode: 'review_repeat',
      sourceType: 'attempt',
      sourceId: attempt._id,
      idempotencyKey: `review:${attempt.enrollmentId}:${attempt.familyId}:${today}`,
    });
  }
  // A chest's XP boost multiplies what this answer earned.
  if (xp > 0) {
    const profile = await EngagementProfile.findById(attempt.userId).select({ boostUntil: 1 }).lean();
    if (profile?.boostUntil && profile.boostUntil > now) {
      xp += await grant(attempt.userId, attempt.sessionId, {
        amount: xp * (BOOST.multiplier - 1),
        reasonCode: 'xp_boost',
        sourceType: 'attempt',
        sourceId: attempt._id,
        idempotencyKey: `attempt:${attempt._id}:boost`,
      });
    }
  }
  return { firstSeen, xp, scheduledStage };
}

export interface SubmitInput {
  session_item_id: string;
  client_submission_id: string;
  selected_options: string[];
  typed_answer?: string;
  input_mode?: 'tap' | 'keyboard' | 'voice';
  confidence?: 'unsure' | 'somewhat' | 'confident';
  reasoning_text?: string;
}

export interface AnswerReceipt {
  attempt_id: string;
  accepted: boolean;
  feedback: Feedback | null;
  /** How learners did on this question on their first try, shown with the feedback. */
  peer: PeerStat | null;
  /** The learner's rating of this question and the learners' average, once feedback is shown. */
  rating: RatingView | null;
  xp_granted?: number;
}

async function receiptFor(attempt: {
  _id: string;
  userId: string;
  questionVersionId: string;
  familyId: string;
  isCorrect?: boolean | null;
  mode: string;
  sessionId: string;
}): Promise<AnswerReceipt> {
  if (attempt.isCorrect == null || DELAYED_FEEDBACK_MODES.has(attempt.mode)) {
    // Mock answers stay sealed until the form is finalized.
    const session = await PracticeSession.findById(attempt.sessionId).select({ status: 1 }).lean();
    if (!session || session.status === 'active' || attempt.isCorrect == null) {
      return { attempt_id: attempt._id, accepted: true, feedback: null, peer: null, rating: null };
    }
  }
  const [qv, key, peers, ratings] = await Promise.all([
    QuestionVersion.findById(attempt.questionVersionId).select({ sourceUrl: 1, answerType: 1 }).lean(),
    QuestionKey.findById(attempt.questionVersionId).lean(),
    peerStats([attempt.familyId]),
    ratingViews(attempt.userId, [attempt.familyId]),
  ]);
  if (!qv || !key) throw new HttpError(500, 'content_missing', 'Grading data is missing for this question');
  return {
    attempt_id: attempt._id,
    accepted: true,
    feedback: buildFeedback(attempt.isCorrect!, key, qv.sourceUrl, qv.answerType as AnswerType),
    peer: peers.get(attempt.familyId) ?? null,
    rating: ratings.get(attempt.familyId) ?? null,
  };
}

/** Whether a retry carries the same answer as the committed attempt, compared in stored form. */
async function sameSubmission(attempt: { sessionItemId: string; questionVersionId: string; selectedOptions: string[]; typedAnswer?: string | null }, input: SubmitInput) {
  if (attempt.sessionItemId !== input.session_item_id) return false;
  const qv = await QuestionVersion.findById(attempt.questionVersionId).select({ answerType: 1, options: 1, matchTargets: 1 }).lean();
  if (!qv) return false;
  try {
    return sameAnswer(attempt, canonicalAnswer({ answerType: qv.answerType as AnswerType, options: qv.options, matchTargets: qv.matchTargets }, input));
  } catch {
    return false;
  }
}

/**
 * Commits one final answer. Retrying with the same client_submission_id and body
 * returns the original result; a different body under that ID is a 409.
 */
export async function submitAnswer(userId: string, sessionId: string, input: SubmitInput): Promise<AnswerReceipt> {
  const prior = await Attempt.findOne({ userId, clientSubmissionId: input.client_submission_id }).lean();
  if (prior) {
    if (prior.sessionId !== sessionId || !(await sameSubmission(prior, input))) {
      throw conflict('idempotency_conflict', 'This submission ID was already used for a different answer');
    }
    return receiptFor(prior);
  }

  const session = await PracticeSession.findOne({ _id: sessionId, userId }).lean();
  if (!session) throw notFound('Session');
  if (session.status === 'active' && session.deadlineAt && session.deadlineAt <= new Date()) {
    const { finalizeSession } = await import('./completion.js');
    await finalizeSession(sessionId, { userId, reason: 'expire' });
    throw conflict('session_expired', 'Time is up. Unanswered questions were scored as incorrect.');
  }

  type Committed = { attempt: AttemptDoc; xp: number; firstSeen: boolean; isCorrect: boolean | null; scheduledStage: number | null };
  let result: Committed | { replayOf: Awaited<ReturnType<typeof Attempt.findOne>> };
  try {
    result = await tx(async (): Promise<typeof result> => {
      const now = new Date();
      // Touching the session serializes concurrent writers on it.
      const locked = await PracticeSession.findOneAndUpdate({ _id: sessionId, userId }, { $inc: { lockVersion: 1 } }, { returnDocument: 'after' }).lean();
      if (!locked) throw notFound('Session');
      if (locked.status !== 'active') throw conflict('session_closed', 'This session is already finished');
      if (locked.deadlineAt && locked.deadlineAt <= now) throw conflict('session_expired', 'Time is up for this session');

      const item = locked.items.find((i) => i._id === input.session_item_id);
      if (!item) throw badRequest('invalid_item', 'That question is not part of this session');
      const existing = await Attempt.findOne({ sessionItemId: item._id });
      if (existing) {
        // A concurrent retry of this same submission committed first: return its result.
        if (existing.clientSubmissionId === input.client_submission_id && (await sameSubmission(existing, input))) return { replayOf: existing };
        throw conflict('already_answered', 'This question already has a final answer');
      }

      const qv = await QuestionVersion.findById(item.questionVersionId).lean();
      if (!qv) throw new HttpError(500, 'content_missing', 'Question content is missing');
      const answerType = qv.answerType as AnswerType;
      const answer = canonicalAnswer({ answerType, options: qv.options, matchTargets: qv.matchTargets }, input);

      const [attempt] = await Attempt.create([
        {
          sessionId,
          sessionItemId: item._id,
          userId,
          enrollmentId: locked.enrollmentId,
          examVersionId: locked.examVersionId,
          questionVersionId: qv._id,
          familyId: item.familyId,
          objectiveId: item.objectiveId,
          domainId: item.domainId,
          mode: locked.mode,
          clientSubmissionId: input.client_submission_id,
          selectedOptions: answer.selected,
          typedAnswer: answer.typed,
          inputMode: input.input_mode ?? (answerType === 'type' ? 'keyboard' : 'tap'),
          confidence: input.confidence ?? null,
          reasoningText: input.reasoning_text ?? null,
          submittedAt: now,
        },
      ]);

      if (DELAYED_FEEDBACK_MODES.has(locked.mode)) {
        return { attempt: attempt!, xp: 0, firstSeen: false, isCorrect: null, scheduledStage: null };
      }
      const key = await QuestionKey.findById(qv._id).lean();
      if (!key) throw new HttpError(500, 'content_missing', 'Grading data is missing for this question');
      const isCorrect = gradeAnswer(answerType, answer, key);
      const user = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
      const timezone = effectiveTimezone(user!, now);
      const effects = await applyGradedAttempt(attempt!, isCorrect, { timezone, now, sessionMode: locked.mode });
      return { attempt: attempt!, isCorrect, ...effects };
    });
  } catch (err) {
    // A concurrent retry with the same submission ID committed first.
    if (isDuplicateKey(err)) {
      const winner = await Attempt.findOne({ userId, clientSubmissionId: input.client_submission_id }).lean();
      if (winner && winner.sessionId === sessionId && (await sameSubmission(winner, input))) return receiptFor(winner);
      throw conflict('already_answered', 'This question already has a final answer');
    }
    throw err;
  }

  if ('replayOf' in result) return receiptFor(result.replayOf!.toObject());
  const { attempt, xp, firstSeen, isCorrect, scheduledStage } = result;
  if (isCorrect !== null) {
    track('answer_graded', { userId, examVersionId: attempt.examVersionId, sessionId, properties: { mode: attempt.mode, correct: isCorrect, first_seen: firstSeen } });
    if (scheduledStage !== null) track('review_scheduled', { userId, examVersionId: attempt.examVersionId, sessionId, properties: { stage: scheduledStage } });
    if (xp > 0) track('reward_granted', { userId, sessionId, properties: { amount: xp } });
  }
  const receipt = await receiptFor(attempt.toObject());
  return { ...receipt, xp_granted: xp };
}
