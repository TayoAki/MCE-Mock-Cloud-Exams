import { tx } from '../db.js';
import {
  Attempt,
  DailyStudyDay,
  Domain,
  LessonProgress,
  NotificationJob,
  PracticeSession,
  QuestionExposure,
  QuestionKey,
  RewardLedger,
  StreakState,
  User,
} from '../models/index.js';
import { track } from '../lib/analytics.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';
import { PRACTICE_SCORE_NOTE, QUALIFYING_ITEMS, XP, displayedStreak } from '../lib/rules.js';
import { effectiveTimezone, localDate } from '../lib/time.js';
import { afterCompletion, type EngagementSummary } from './engagement.js';
import { applyGradedAttempt, gradeSelection, grantReward } from './grading.js';
import { creditDay, syncStreak } from './streaks.js';

/** Modes a learner may submit before answering everything; the rest must be complete. */
const EARLY_SUBMIT_MODES = new Set(['mock', 'timed']);

export interface Completion {
  session_id: string;
  mode: string;
  status: 'completed' | 'expired';
  correct: number;
  total: number;
  answered: number;
  xp_granted: number;
  study_day_credited: boolean;
  current_streak: number;
  domains: { domain_id: string; title: string; correct: number; total: number }[];
  practice_score_note: typeof PRACTICE_SCORE_NOTE;
  sample: boolean;
  fresh_count: number | null;
  lesson_id: string | null;
  completed_at: string;
  /** Quests, level, gems, league and celebrations from this session. */
  engagement: EngagementSummary;
}

/**
 * Finalizes a session exactly once, using server time. Retries and concurrent
 * calls return the same stored summary without granting anything again.
 */
export async function finalizeSession(
  sessionId: string,
  opts: { userId?: string; reason: 'submit' | 'expire' },
): Promise<Completion> {
  let fresh = false;
  const completion = await tx(async () => {
    const now = new Date();
    const filter = opts.userId ? { _id: sessionId, userId: opts.userId } : { _id: sessionId };
    const session = await PracticeSession.findOneAndUpdate(filter, { $inc: { lockVersion: 1 } }, { returnDocument: 'after' });
    if (!session) throw notFound('Session');
    if (session.completion) return session.completion as Completion;
    if (session.status === 'abandoned') throw conflict('session_abandoned', 'This session was abandoned');

    const overdue = !!session.deadlineAt && session.deadlineAt <= now;
    if (opts.reason === 'expire' && !overdue) throw conflict('not_expired', 'This session still has time remaining');
    const status: Completion['status'] = overdue ? 'expired' : 'completed';

    const attempts = await Attempt.find({ sessionId: session._id });
    const answered = new Map(attempts.map((a) => [a.sessionItemId, a]));
    if (status === 'completed' && !EARLY_SUBMIT_MODES.has(session.mode) && answered.size < session.items.length) {
      throw conflict('items_unanswered', 'Answer every question before finishing', {
        unanswered: session.items.length - answered.size,
      });
    }

    const user = await User.findById(session.userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
    if (!user) throw notFound('User');
    const timezone = effectiveTimezone(user, now);

    // Sealed answers (mock) are graded now, applying the same learning effects.
    for (const attempt of attempts) {
      if (attempt.isCorrect !== null) continue;
      const key = await QuestionKey.findById(attempt.questionVersionId).lean();
      if (!key) throw new HttpError(500, 'content_missing', 'Grading data is missing for a question');
      await applyGradedAttempt(attempt, gradeSelection(attempt.selectedOptions, key.correctOptions), {
        timezone,
        now,
        sessionMode: session.mode,
      });
    }
    // Answers to unanswered items are revealed after finalizing, so those families count as seen.
    for (const item of session.items) {
      if (answered.has(item._id)) continue;
      await QuestionExposure.updateOne(
        { userId: session.userId, familyId: item.familyId },
        {
          $setOnInsert: { firstSeenAt: now, examVersionId: session.examVersionId, objectiveId: item.objectiveId, answeredCount: 0 },
          $set: { lastSeenAt: now },
        },
        { upsert: true },
      );
    }

    // Unanswered items score incorrect; invalidated attempts are excluded later by repair jobs.
    const domains = await Domain.find({ examVersionId: session.examVersionId }).sort({ sortOrder: 1 }).lean();
    const perDomain = new Map(domains.map((d) => [d._id, { domain_id: d._id, title: d.title, correct: 0, total: 0 }]));
    let correct = 0;
    for (const item of session.items) {
      const row = perDomain.get(item.domainId);
      const ok = answered.get(item._id)?.isCorrect === true;
      if (ok) correct++;
      if (row) {
        row.total++;
        if (ok) row.correct++;
      }
    }

    if (status === 'completed' && session.lessonId && (session.mode === 'lesson' || session.mode === 'checkpoint')) {
      await LessonProgress.updateOne(
        { enrollmentId: session.enrollmentId, lessonId: session.lessonId },
        { $set: { state: 'completed', completedAt: now }, $setOnInsert: { userId: session.userId, startedAt: session.startedAt } },
        { upsert: true },
      );
      await grantReward(session.userId, session._id, {
        amount: XP.lessonComplete,
        reasonCode: 'lesson_complete',
        sourceType: 'session',
        sourceId: session._id,
        idempotencyKey: `enrollment:${session.enrollmentId}:lesson:${session.lessonId}:complete`,
      });
    }

    // Study credit depends on submitted work, not correctness. Unanswered timeout items don't count.
    const qualifying = answered.size >= QUALIFYING_ITEMS;
    let studyDayCredited = false;
    const today = localDate(now, timezone);
    // Missed days are protected (or the streak breaks) before today's credit.
    await syncStreak(session.userId, today);
    if (qualifying) {
      const credit = await DailyStudyDay.updateOne(
        { userId: session.userId, studyDate: today },
        { $setOnInsert: { timezoneSnapshot: timezone, qualifyingSessionId: session._id, earnedAt: now } },
        { upsert: true },
      );
      if (credit.upsertedCount) {
        studyDayCredited = true;
        await creditDay(session.userId, today);
        await NotificationJob.updateMany(
          { userId: session.userId, studyDate: today, status: 'queued' },
          { $set: { status: 'cancelled', reason: 'studied' } },
        );
      }
    }

    // Mark the session finished first, so quests and badges count it.
    const config = (session.selectionConfig ?? {}) as { sample?: boolean; fresh_count?: number };
    session.status = status;
    session.completedAt = now;
    session.qualifying = qualifying;
    session.completion = { mode: session.mode, correct, total: session.items.length };
    await session.save();
    const engagement = await afterCompletion({
      userId: session.userId,
      session,
      status,
      correct,
      total: session.items.length,
      timezone,
      today,
      studyDayCredited,
      now,
    });
    const streak = (await StreakState.findById(session.userId).lean())!;
    const xpRows = await RewardLedger.find({ sessionId: session._id }).select({ amount: 1 }).lean();
    const summary: Completion = {
      session_id: session._id,
      mode: session.mode,
      status,
      correct,
      total: session.items.length,
      answered: answered.size,
      xp_granted: xpRows.reduce((sum, r) => sum + r.amount, 0),
      study_day_credited: studyDayCredited,
      current_streak: displayedStreak(
        { lastStudyDate: streak.lastStudyDate ?? null, lastCoveredDate: streak.lastCoveredDate ?? null, currentDays: streak.currentDays, longestDays: streak.longestDays },
        today,
      ),
      domains: [...perDomain.values()].filter((d) => d.total > 0),
      practice_score_note: PRACTICE_SCORE_NOTE,
      sample: !!config.sample,
      fresh_count: typeof config.fresh_count === 'number' ? config.fresh_count : null,
      lesson_id: session.lessonId ?? null,
      completed_at: now.toISOString(),
      engagement,
    };

    session.completion = summary;
    await session.save();
    fresh = true;
    return summary;
  });

  if (fresh) {
    const userId = opts.userId ?? (await PracticeSession.findById(sessionId).select({ userId: 1 }).lean())?.userId;
    const props = { mode: completion.mode, status: completion.status, correct: completion.correct, total: completion.total };
    track('session_completed', { userId, sessionId, properties: { ...props, qualifying: completion.answered >= QUALIFYING_ITEMS } });
    if (completion.mode === 'mock') {
      track('mock_finalized', { userId, sessionId, properties: { ...props, sample: completion.sample, fresh_count: completion.fresh_count } });
    }
    if (completion.study_day_credited) track('study_day_credited', { userId, sessionId, properties: { current_streak: completion.current_streak } });
  }
  return completion;
}

/** Expires every active session whose server deadline has passed. */
export async function expireOverdueSessions(now = new Date()) {
  const overdue = await PracticeSession.find({ status: 'active', deadlineAt: { $ne: null, $lte: now } })
    .select({ _id: 1 })
    .limit(200)
    .lean();
  let expired = 0;
  for (const s of overdue) {
    try {
      await finalizeSession(s._id, { reason: 'expire' });
      expired++;
    } catch (err) {
      console.error(JSON.stringify({ t: new Date().toISOString(), worker: 'expire', session: s._id, error: String(err) }));
    }
  }
  return expired;
}
