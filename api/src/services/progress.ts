import {
  Attempt,
  DailyStudyDay,
  Enrollment,
  ObjectiveProgress,
  PracticeSession,
  ReviewQueue,
  RewardLedger,
  StreakState,
} from '../models/index.js';
import { notFound } from '../lib/errors.js';
import { MIN_RANKING_SAMPLE, displayedStreak } from '../lib/rules.js';
import { addDays, localDate, localWeek } from '../lib/time.js';
import { loadBlueprint } from './content.js';
import { objectiveWeights, rankObjectives } from './selection.js';

export async function ownedEnrollment(userId: string, enrollmentId: string) {
  const enrollment = await Enrollment.findOne({ _id: enrollmentId, userId }).lean();
  if (!enrollment) throw notFound('Enrollment');
  return enrollment;
}

/**
 * Practice evidence with denominators. Coverage, new-family accuracy, repeat
 * accuracy, XP and mock scores stay separate. There is no pass probability.
 */
export async function progressReport(userId: string, enrollmentId: string) {
  const enrollment = await ownedEnrollment(userId, enrollmentId);
  const { domains, objectives } = await loadBlueprint(enrollment.examVersionId);
  const [objectiveRows, repeatAgg, mocks] = await Promise.all([
    ObjectiveProgress.find({ enrollmentId }).lean(),
    Attempt.aggregate<{ _id: null; total: number; correct: number }>([
      { $match: { userId, enrollmentId, gradedAt: { $ne: null }, invalidatedAt: null, firstSeenFamily: false } },
      { $group: { _id: null, total: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } } } },
    ]),
    PracticeSession.find({ enrollmentId, mode: 'mock', status: { $in: ['completed', 'expired'] } })
      .sort({ completedAt: -1 })
      .limit(10)
      .select({ completion: 1 })
      .lean(),
  ]);

  const byObjective = new Map(objectiveRows.map((r) => [r.objectiveId, r]));
  const firstSeenTotal = objectiveRows.reduce((s, r) => s + r.firstSeenTotal, 0);
  const firstSeenCorrect = objectiveRows.reduce((s, r) => s + r.firstSeenCorrect, 0);
  const practiced = objectives.filter((o) => (byObjective.get(o._id)?.totalAttempts ?? 0) > 0).length;

  const domainRows = domains.map((d) => {
    const objs = objectives.filter((o) => o.domainId === d._id);
    const rows = objs.map((o) => byObjective.get(o._id)).filter((r) => !!r);
    const total = rows.reduce((s, r) => s + r!.firstSeenTotal, 0);
    const correct = rows.reduce((s, r) => s + r!.firstSeenCorrect, 0);
    return {
      domain_id: d._id,
      title: d.title,
      weight_percent: d.weightPercent,
      first_seen_correct: correct,
      first_seen_total: total,
      objectives_practiced: objs.filter((o) => (byObjective.get(o._id)?.totalAttempts ?? 0) > 0).length,
      objectives_total: objs.length,
      // Hide percentages until there is enough evidence to rank.
      enough_practice: total >= MIN_RANKING_SAMPLE,
    };
  });

  const ranking = await rankObjectives(enrollmentId, objectives.map((o) => o._id), objectiveWeights(domains, objectives));
  const top = ranking[0];
  const focusObjective = top ? objectives.find((o) => o._id === top.objectiveId) : undefined;
  const repeat = repeatAgg[0];

  return {
    enrollment_id: enrollmentId,
    practiced_objectives: practiced,
    total_objectives: objectives.length,
    first_seen_correct: firstSeenCorrect,
    first_seen_total: firstSeenTotal,
    repeat_correct: repeat?.correct ?? 0,
    repeat_total: repeat?.total ?? 0,
    latest_mock: mocks[0]?.completion ?? null,
    mock_history: mocks.map((m) => m.completion).filter(Boolean),
    domains: domainRows,
    focus:
      top && focusObjective
        ? {
            objective_id: focusObjective._id,
            title: focusObjective.title,
            domain_id: focusObjective.domainId,
            reason: top.reason,
            first_seen_correct: top.correct,
            first_seen_total: top.total,
          }
        : null,
    min_ranking_sample: MIN_RANKING_SAMPLE,
    note: 'Practice evidence only. Not a pass prediction.',
  };
}

export async function reviewQueue(userId: string, enrollmentId: string, now = new Date()) {
  const enrollment = await ownedEnrollment(userId, enrollmentId);
  const [{ objectives, domains }, entries, missed] = await Promise.all([
    loadBlueprint(enrollment.examVersionId),
    ReviewQueue.find({ enrollmentId }).sort({ dueAt: 1 }).lean(),
    missedCount(userId, enrollment.examVersionId),
  ]);
  const titles = new Map(objectives.map((o) => [o._id, o]));
  const domainTitles = new Map(domains.map((d) => [d._id, d.title]));
  const rows = entries.map((e) => {
    const o = titles.get(e.objectiveId);
    return {
      objective_id: e.objectiveId,
      title: o?.title ?? '',
      domain_title: o ? (domainTitles.get(o.domainId) ?? '') : '',
      due_at: e.dueAt.toISOString(),
      stage: e.stage,
      due: e.dueAt <= now,
      reason: e.reason,
    };
  });
  return {
    enrollment_id: enrollmentId,
    due_count: rows.filter((r) => r.due).length,
    missed_count: missed,
    due: rows.filter((r) => r.due),
    upcoming: rows.filter((r) => !r.due).slice(0, 20),
  };
}

export async function missedCount(userId: string, examVersionId: string) {
  const rows = await Attempt.aggregate<{ n: number }>([
    { $match: { userId, examVersionId, gradedAt: { $ne: null }, invalidatedAt: null } },
    { $sort: { gradedAt: -1 } },
    { $group: { _id: '$familyId', isCorrect: { $first: '$isCorrect' } } },
    { $match: { isCorrect: false } },
    { $count: 'n' },
  ]);
  return rows[0]?.n ?? 0;
}

export async function xpTotal(userId: string) {
  const rows = await RewardLedger.aggregate<{ xp: number }>([
    { $match: { userId } },
    { $group: { _id: null, xp: { $sum: '$amount' } } },
  ]);
  return rows[0]?.xp ?? 0;
}

/** Streak plus the current local week's credited days (for the M–S dots). */
export async function habitSummary(userId: string, timezone: string, now = new Date()) {
  const today = localDate(now, timezone);
  const week = localWeek(now, timezone);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(week.startDate, i));
  const [streak, credited] = await Promise.all([
    StreakState.findById(userId).lean(),
    DailyStudyDay.find({ userId, studyDate: { $in: weekDates } }).select({ studyDate: 1 }).lean(),
  ]);
  const creditedSet = new Set(credited.map((c) => c.studyDate));
  const state = {
    lastStudyDate: streak?.lastStudyDate ?? null,
    currentDays: streak?.currentDays ?? 0,
    longestDays: streak?.longestDays ?? 0,
  };
  return {
    current: displayedStreak(state, today),
    longest: state.longestDays,
    last_study_date: state.lastStudyDate,
    studied_today: state.lastStudyDate === today,
    today,
    week: weekDates.map((date) => ({ date, studied: creditedSet.has(date), is_today: date === today })),
  };
}
