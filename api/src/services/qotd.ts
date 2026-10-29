import { Attempt, DailyQuestion, Domain, EXAM_ANSWER_TYPES, Objective, PracticeSession, QotdStreak, User, type AnswerType } from '../models/index.js';
import { seededRandom } from '../lib/answers.js';
import { isDuplicateKey } from '../lib/errors.js';
import { GEMS } from '../lib/rules.js';
import { addDays, daysBetween, effectiveTimezone, localDate } from '../lib/time.js';
import { latestPublishedByFamily, type QuestionVersionLean } from './content.js';
import { peerStats } from './peer.js';
import { ownedEnrollment } from './progress.js';
import { earnGems } from './wallet.js';

/** A question is not repeated as the Question of the Day within this many days, while others remain. */
const QOTD_NO_REPEAT_DAYS = 60;

/**
 * The day's question for an exam version. Everyone on the same local date gets
 * the same question; it is picked once (deterministically from the date) and stored,
 * so publishing new questions later in the day doesn't change it.
 */
export async function dailyQuestion(examVersionId: string, date: string): Promise<QuestionVersionLean | null> {
  const stored = await DailyQuestion.findOne({ examVersionId, date }).lean();
  if (stored) return (await latestPublishedByFamily(examVersionId, [stored.familyId])).get(stored.familyId) ?? null;

  const all = [...(await latestPublishedByFamily(examVersionId)).values()]
    .filter((q) => EXAM_ANSWER_TYPES.includes(q.answerType as AnswerType))
    .sort((a, b) => (a.familyId < b.familyId ? -1 : 1));
  if (all.length === 0) return null;
  const recent = new Set(
    (await DailyQuestion.find({ examVersionId, date: { $gte: addDays(date, -QOTD_NO_REPEAT_DAYS), $lt: date } }).select({ familyId: 1 }).lean()).map((d) => d.familyId),
  );
  const fresh = all.filter((q) => !recent.has(q.familyId));
  const pool = fresh.length ? fresh : all;
  const pick = pool[Math.floor(seededRandom(`${examVersionId}:${date}`)() * pool.length)]!;
  try {
    await DailyQuestion.create({ examVersionId, date, familyId: pick.familyId });
    return pick;
  } catch (err) {
    // Another request picked first; everyone gets that one.
    if (!isDuplicateKey(err)) throw err;
    return dailyQuestion(examVersionId, date);
  }
}

/** The QotD streak shown today: alive while the last answered day is today or yesterday. */
export function displayedQotdStreak(state: { currentDays: number; lastDate?: string | null }, today: string) {
  if (!state.lastDate) return 0;
  return daysBetween(state.lastDate, today) <= 1 ? state.currentDays : 0;
}

/**
 * Credits the day a finished Question of the Day belongs to. Answering counts,
 * right or wrong. Runs inside the completion transaction.
 */
export async function creditQotd(userId: string, date: string, now: Date) {
  const state = (await QotdStreak.findById(userId).lean()) ?? { currentDays: 0, longestDays: 0, lastDate: null as string | null };
  if (state.lastDate && daysBetween(state.lastDate, date) <= 0) return { credited: false, current: state.currentDays, longest: state.longestDays };
  const current = state.lastDate && daysBetween(state.lastDate, date) === 1 ? state.currentDays + 1 : 1;
  const longest = Math.max(state.longestDays, current);
  await QotdStreak.updateOne(
    { _id: userId },
    { $set: { currentDays: current, longestDays: longest, lastDate: date, updatedAt: now }, $inc: { answered: 1 } },
    { upsert: true },
  );
  await earnGems(userId, GEMS.qotd, 'qotd', `qotd:${date}`);
  return { credited: true, current, longest };
}

/** Today's question, whether it's answered, its result and the QotD streak, for the Learn tab. */
export async function qotdView(userId: string, enrollmentId: string) {
  const enrollment = await ownedEnrollment(userId, enrollmentId);
  const user = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  const today = localDate(new Date(), effectiveTimezone(user!));
  const question = await dailyQuestion(enrollment.examVersionId, today);
  const streak = (await QotdStreak.findById(userId).lean()) ?? { currentDays: 0, longestDays: 0, lastDate: null };
  const sessions = await PracticeSession.find({ userId, enrollmentId, mode: 'qotd', 'selectionConfig.date': today, status: { $in: ['active', 'completed'] } })
    .sort({ startedAt: -1 })
    .select({ _id: 1, status: 1 })
    .lean();
  const done = sessions.find((s) => s.status === 'completed');
  const active = sessions.find((s) => s.status === 'active');
  const attempt = done ? await Attempt.findOne({ sessionId: done._id }).select({ isCorrect: 1, familyId: 1 }).lean() : null;
  const [objective, domain] = question
    ? await Promise.all([Objective.findById(question.objectiveId).select({ title: 1 }).lean(), Domain.findById(question.domainId).select({ title: 1 }).lean()])
    : [null, null];
  const peer = attempt ? ((await peerStats([attempt.familyId])).get(attempt.familyId) ?? null) : null;
  return {
    date: today,
    available: !!question,
    question: question
      ? { prompt: question.prompt, answer_type: question.answerType, objective_title: objective?.title ?? '', domain_title: domain?.title ?? '' }
      : null,
    status: done ? ('done' as const) : active ? ('in_progress' as const) : ('new' as const),
    session_id: (done ?? active)?._id ?? null,
    result: done ? { correct: attempt?.isCorrect === true, peer } : null,
    streak: {
      current: displayedQotdStreak(streak, today),
      longest: streak.longestDays,
      answered_today: streak.lastDate === today,
    },
    gems: GEMS.qotd,
  };
}
