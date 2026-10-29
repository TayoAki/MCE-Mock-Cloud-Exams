import { Attempt, Enrollment, FlaggedQuestion, Objective, PracticeSession, ReviewQueue, User, type SessionMode } from '../models/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { effectiveTimezone, localDate, startOfLocalDay } from '../lib/time.js';
import type { Completion } from './completion.js';
import { loadBlueprint } from './content.js';
import { computePath } from './path.js';
import { objectiveWeights, rankObjectives } from './selection.js';

export type SuggestionKind = 'take_break' | 'level_up' | 'retry_missed' | 'review_due' | 'qotd' | 'next_lesson' | 'flagged' | 'weakest';

export interface Suggestion {
  kind: SuggestionKind;
  title: string;
  body: string;
  cta: string;
  /** What starting the suggestion means; null for a break. */
  start: {
    mode: SessionMode;
    lesson_id?: string;
    domain_ids?: string[];
    source_session_id?: string;
  } | null;
}

/** A day this long (or this many sessions) earns a gentle suggestion to stop for now. */
const LONG_DAY = { minutes: 40, sessions: 5 } as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What to do after a finished session, worked out from what is actually
 * pending now: a Level Up result, this session's misses, due reviews, today's
 * question, the next lesson, flags and the weakest objective. A long study
 * day leads with a break. Computed live, so it stays right on a later visit.
 */
export async function nextSteps(userId: string, sessionId: string) {
  const session = await PracticeSession.findOne({ _id: sessionId, userId }).lean();
  if (!session) throw notFound('Session');
  const completion = session.completion as Completion | null;
  if (!completion || !('session_id' in completion)) throw conflict('not_finalized', 'Suggestions are available after the session is finished');

  const enrollment = await Enrollment.findById(session.enrollmentId).lean();
  if (!enrollment) throw notFound('Enrollment');
  const user = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  const now = new Date();
  const timezone = effectiveTimezone(user!, now);
  const today = localDate(now, timezone);
  const dayStart = startOfLocalDay(today, timezone);

  const out: Suggestion[] = [];

  const finishedToday = await PracticeSession.find({ userId, status: { $in: ['completed', 'expired'] }, completedAt: { $gte: dayStart } })
    .select({ startedAt: 1, completedAt: 1 })
    .lean();
  // Sessions resumed hours later don't count as an hour of study.
  const minutes = Math.round(
    finishedToday.reduce((sum, s) => sum + Math.min(30 * 60_000, Math.max(0, s.completedAt!.getTime() - s.startedAt.getTime())), 0) / 60_000,
  );
  const longDay = minutes >= LONG_DAY.minutes || finishedToday.length >= LONG_DAY.sessions;

  const levelUp = completion.level_up;
  if (session.mode === 'levelup' && levelUp) {
    if (levelUp.passed && levelUp.next_level && levelUp.next_level.level > levelUp.level) {
      out.push({
        kind: 'level_up',
        title: `Level ${levelUp.next_level.level}: ${levelUp.next_level.label}`,
        body: `You unlocked the next level in ${levelUp.domain_title}. The questions get harder from here.`,
        cta: 'Start the next level',
        start: { mode: 'levelup', domain_ids: [levelUp.domain_id] },
      });
    } else if (!levelUp.passed) {
      out.push({
        kind: 'level_up',
        title: `Try Level ${levelUp.level} again`,
        body: `You need ${levelUp.needed} of ${levelUp.total} to pass. Each try draws fresh questions where there are any.`,
        cta: 'Try again',
        start: { mode: 'levelup', domain_ids: [levelUp.domain_id] },
      });
    }
  }

  const missedHere = await Attempt.countDocuments({ sessionId: session._id, isCorrect: false });
  const retry: Suggestion | null =
    missedHere > 0 && session.mode !== 'qotd'
      ? {
          kind: 'retry_missed',
          title: missedHere === 1 ? 'Retry the one you missed' : `Retry the ${missedHere} you missed`,
          body: 'Trying again right away, after seeing the explanation, helps the right answer stick.',
          cta: 'Retry now',
          start: { mode: 'missed', source_session_id: session._id },
        }
      : null;
  if (retry && missedHere >= 2) out.push(retry);

  const due = await ReviewQueue.countDocuments({ enrollmentId: enrollment._id, dueAt: { $lte: now } });
  if (due > 0 && session.mode !== 'review') {
    out.push({
      kind: 'review_due',
      title: `${plural(due, 'concept')} due for review`,
      body: 'Spaced reviews bring back what you’re about to forget.',
      cta: 'Review now',
      start: { mode: 'review' },
    });
  }

  const qotdDone = await PracticeSession.exists({ userId, enrollmentId: enrollment._id, mode: 'qotd', 'selectionConfig.date': today, status: 'completed' });
  if (!qotdDone && session.mode !== 'qotd') {
    out.push({ kind: 'qotd', title: 'Question of the Day', body: 'One question, the same for every learner today. Keep your daily streak going.', cta: 'Answer it', start: { mode: 'qotd' } });
  }

  const path = await computePath(enrollment);
  const next = path.lessons.find((l) => l.id === path.current_lesson_id);
  if (next) {
    out.push({
      kind: 'next_lesson',
      title: next.title,
      body: session.mode === 'lesson' || session.mode === 'checkpoint' ? `Up next in ${next.unit_title}.` : `Continue your path in ${next.unit_title}.`,
      cta: next.state === 'in_progress' ? 'Resume lesson' : 'Start lesson',
      start: { mode: 'lesson', lesson_id: next.id },
    });
  }

  const flagged = await FlaggedQuestion.countDocuments({ userId, examVersionId: enrollment.examVersionId });
  if (flagged >= 3 && session.mode !== 'flagged') {
    out.push({
      kind: 'flagged',
      title: `Quiz your ${flagged} flagged questions`,
      body: 'The questions you bookmarked to come back to.',
      cta: 'Start quiz',
      start: { mode: 'flagged' },
    });
  }
  if (retry && missedHere === 1) out.push(retry);

  const { domains, objectives } = await loadBlueprint(enrollment.examVersionId);
  const ranking = await rankObjectives(enrollment._id, objectives.map((o) => o._id), objectiveWeights(domains, objectives));
  const focus = ranking[0] ? await Objective.findById(ranking[0].objectiveId).select({ title: 1 }).lean() : null;
  out.push({
    kind: 'weakest',
    title: focus ? `Practice ${focus.title}` : 'Practice your weakest topic',
    body: ranking[0]?.reason === 'low_accuracy' ? 'Your lowest first-try accuracy right now.' : 'The topic you’ve practiced least so far.',
    cta: 'Practice',
    start: { mode: 'weakest' },
  });

  if (longDay) {
    out.unshift({
      kind: 'take_break',
      title: 'Nice work. Take a break',
      body: `You’ve ${minutes >= 5 ? `studied about ${minutes} minutes` : `finished ${plural(finishedToday.length, 'session')}`} today. Coming back after a break helps it stick.`,
      cta: 'Done for now',
      start: null,
    });
  }
  return { session_id: session._id, primary: out[0]!, secondary: out[1] ?? null, studied_minutes_today: minutes };
}
