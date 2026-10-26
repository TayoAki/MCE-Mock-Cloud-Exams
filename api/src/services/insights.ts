import { DateTime } from 'luxon';
import {
  Achievement,
  Attempt,
  DailyStudyDay,
  Domain,
  Enrollment,
  GemLedger,
  HighFive,
  LeagueMember,
  ObjectiveProgress,
  PracticeSession,
  RewardLedger,
  ScoreSnapshot,
  User,
} from '../models/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { addDays, daysBetween, effectiveTimezone, localDate, startOfLocalDay } from '../lib/time.js';
import { monthlyBadge, ACHIEVEMENTS } from './achievements.js';
import { loadBlueprint } from './content.js';

/**
 * CertPath Score: how much of the exam blueprint a learner has practised, and
 * how accurately on first tries. It is practice evidence, not a prediction.
 *
 * - Objective: first-try accuracy on new questions, smoothed toward 50% while
 *   evidence is thin ((correct + 1) / (total + 2)), times coverage, which
 *   reaches full credit after five new questions.
 * - Domain: the mean of its objectives.
 * - Overall: domains weighted by the exam blueprint, as 0 to 100.
 */

export const SCORE_NOTE = 'A practice score from your own first-try answers, weighted like the exam blueprint. It is not a prediction of your exam result.';
const FULL_COVERAGE = 5;

export function objectiveScore(total: number, correct: number) {
  if (total <= 0) return 0;
  return Math.min(1, total / FULL_COVERAGE) * ((correct + 1) / (total + 2));
}

const BANDS: [number, string][] = [
  [0, 'Getting started'],
  [20, 'Building'],
  [45, 'Solid'],
  [70, 'Strong'],
  [85, 'Mastering'],
];
export const bandFor = (score: number) => [...BANDS].reverse().find(([min]) => score >= min)![1];

export async function certScore(enrollmentId: string, examVersionId: string) {
  const { domains, objectives } = await loadBlueprint(examVersionId);
  const rows = new Map((await ObjectiveProgress.find({ enrollmentId }).lean()).map((r) => [r.objectiveId, r]));
  const totalWeight = domains.reduce((s, d) => s + d.weightPercent, 0) || 1;
  const domainScores = domains.map((d) => {
    const objs = objectives.filter((o) => o.domainId === d._id);
    const scores = objs.map((o) => objectiveScore(rows.get(o._id)?.firstSeenTotal ?? 0, rows.get(o._id)?.firstSeenCorrect ?? 0));
    const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      domain_id: d._id,
      title: d.title,
      weight_percent: d.weightPercent,
      score: Math.round(score * 100),
      raw: score,
      objectives_practiced: objs.filter((o) => (rows.get(o._id)?.firstSeenTotal ?? 0) > 0).length,
      objectives_total: objs.length,
    };
  });
  const overall = Math.round((domainScores.reduce((s, d) => s + d.raw * d.weight_percent, 0) / totalWeight) * 100);
  return { score: overall, domains: domainScores.map(({ raw: _raw, ...d }) => d) };
}

async function zoneOf(userId: string, now: Date) {
  const user = await User.findById(userId).select({ timezone: 1, pendingTimezone: 1 }).lean();
  if (!user) throw notFound('User');
  return effectiveTimezone(user, now);
}

/** Stores today's score for the trend line. Called after each finished session and when the score is viewed. */
export async function recordScoreSnapshot(userId: string, enrollmentId: string, now = new Date()) {
  const enrollment = await Enrollment.findOne({ _id: enrollmentId, userId }).lean();
  if (!enrollment) return null;
  const { score } = await certScore(enrollmentId, enrollment.examVersionId);
  const date = localDate(now, await zoneOf(userId, now));
  await ScoreSnapshot.updateOne({ enrollmentId, date }, { $set: { userId, score, updatedAt: now } }, { upsert: true });
  return score;
}

export async function scoreView(userId: string, enrollmentId: string, now = new Date()) {
  const enrollment = await Enrollment.findOne({ _id: enrollmentId, userId }).lean();
  if (!enrollment) throw notFound('Enrollment');
  const { score, domains } = await certScore(enrollmentId, enrollment.examVersionId);
  const today = localDate(now, await zoneOf(userId, now));
  await ScoreSnapshot.updateOne({ enrollmentId, date: today }, { $set: { userId, score, updatedAt: now } }, { upsert: true });
  const history = await ScoreSnapshot.find({ enrollmentId, date: { $gte: addDays(today, -29) } }).sort({ date: 1 }).select({ date: 1, score: 1 }).lean();
  const weekAgo = await ScoreSnapshot.findOne({ enrollmentId, date: { $lte: addDays(today, -7) } }).sort({ date: -1 }).lean();
  const practiced = domains.filter((d) => d.objectives_practiced > 0);
  // The biggest weighted gap: where practice would raise the score most.
  const focus = [...domains].sort((a, b) => b.weight_percent * (100 - b.score) - a.weight_percent * (100 - a.score))[0];
  return {
    score,
    band: bandFor(score),
    max: 100,
    delta_7d: weekAgo ? score - weekAgo.score : null,
    history: history.map((h) => ({ date: h.date, score: h.score })),
    domains,
    strongest: practiced.length ? [...practiced].sort((a, b) => b.score - a.score)[0]!.title : null,
    focus: focus && focus.score < 100 ? { domain_id: focus.domain_id, title: focus.title } : null,
    method: 'Each objective counts your first-try accuracy on new questions, smoothed while evidence is thin, and reaches full weight after five questions. Domains are weighted like the exam blueprint.',
    note: SCORE_NOTE,
  };
}

// ---------- Recaps ----------

type Period = { kind: 'month' | 'year'; label: string; start: string; end: string };

/** A month (YYYY-MM) or year (YYYY). Defaults to last month during the first week of a month. */
export function resolvePeriod(kind: 'month' | 'year', value: string | undefined, today: string): Period {
  if (kind === 'year') {
    const year = value ?? today.slice(0, 4);
    if (!/^\d{4}$/.test(year)) throw badRequest('invalid_period', 'Use a year like 2026');
    return { kind, label: year, start: `${year}-01-01`, end: `${Number(year) + 1}-01-01` };
  }
  const month = value ?? (Number(today.slice(8, 10)) <= 7 ? DateTime.fromISO(today).minus({ months: 1 }).toFormat('yyyy-MM') : today.slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('invalid_period', 'Use a month like 2026-10');
  const start = `${month}-01`;
  return { kind, label: DateTime.fromISO(start).toFormat('LLLL yyyy'), start, end: DateTime.fromISO(start).plus({ months: 1 }).toISODate()! };
}

/** The longest run of consecutive study dates. */
function longestRun(dates: string[]) {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...dates].sort()) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

const PERSONAS = {
  night_owl: { title: 'Night owl', body: 'Most of your practice happened after 8 pm. The quiet hours are yours.' },
  early_bird: { title: 'Early bird', body: 'You did most of your practice before 9 am, before the day got busy.' },
  lunch_learner: { title: 'Lunch-break learner', body: 'You fitted practice into the middle of the day, again and again.' },
  weekend_warrior: { title: 'Weekend warrior', body: 'Saturdays and Sundays were your big study days.' },
  steady: { title: 'Steady builder', body: 'You showed up on most days. That consistency is what builds recall.' },
  explorer: { title: 'Explorer', body: 'You practised across the day and the week, whenever you could.' },
} as const;

export async function recap(userId: string, kind: 'month' | 'year', value?: string, now = new Date()) {
  const zone = await zoneOf(userId, now);
  const today = localDate(now, zone);
  const period = resolvePeriod(kind, value, today);
  const from = startOfLocalDay(period.start, zone);
  const to = startOfLocalDay(period.end, zone);
  const range = { $gte: from, $lt: to };
  const days = Math.max(1, Math.min(daysBetween(period.start, period.end), daysBetween(period.start, today) + 1));

  const studyDates = (await DailyStudyDay.find({ userId, studyDate: { $gte: period.start, $lt: period.end } }).select({ studyDate: 1 }).lean()).map((d) => d.studyDate);
  const attempts = await Attempt.aggregate<{ _id: null; total: number; correct: number }>([
    { $match: { userId, submittedAt: range, gradedAt: { $ne: null } } },
    { $group: { _id: null, total: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } } } },
  ]);
  const xp = (await RewardLedger.aggregate<{ xp: number }>([{ $match: { userId, createdAt: range } }, { $group: { _id: null, xp: { $sum: '$amount' } } }]))[0]?.xp ?? 0;
  const gems = (await GemLedger.aggregate<{ g: number }>([{ $match: { userId, createdAt: range, amount: { $gt: 0 } } }, { $group: { _id: null, g: { $sum: '$amount' } } }]))[0]?.g ?? 0;
  const sessions = await PracticeSession.find({ userId, completedAt: range, status: { $in: ['completed', 'expired'] } })
    .select({ mode: 1, startedAt: 1, completedAt: 1 })
    .lean();
  const minutes = Math.round(sessions.reduce((s, x) => s + Math.min(30 * 60_000, Math.max(0, x.completedAt!.getTime() - x.startedAt.getTime())), 0) / 60_000);

  const bestDay = (
    await RewardLedger.aggregate<{ _id: string; xp: number }>([
      { $match: { userId, createdAt: range } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: zone } }, xp: { $sum: '$amount' } } },
      { $sort: { xp: -1 } },
      { $limit: 1 },
    ])
  )[0];
  const topDomainRow = (
    await Attempt.aggregate<{ _id: string; n: number }>([{ $match: { userId, submittedAt: range } }, { $group: { _id: '$domainId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 }])
  )[0];
  const topDomain = topDomainRow ? await Domain.findById(topDomainRow._id).select({ title: 1 }).lean() : null;

  // When practice happened, in the learner's own time.
  const when = await Attempt.aggregate<{ _id: { hour: number; dow: number }; n: number }>([
    { $match: { userId, submittedAt: range } },
    { $group: { _id: { hour: { $hour: { date: '$submittedAt', timezone: zone } }, dow: { $dayOfWeek: { date: '$submittedAt', timezone: zone } } }, n: { $sum: 1 } } },
  ]);
  const total = when.reduce((s, w) => s + w.n, 0);
  const share = (test: (w: { hour: number; dow: number }) => boolean) => (total ? when.filter((w) => test(w._id)).reduce((s, w) => s + w.n, 0) / total : 0);
  const persona: keyof typeof PERSONAS =
    total === 0
      ? 'explorer'
      : studyDates.length / days >= 0.6
        ? 'steady'
        : share((w) => w.hour >= 20 || w.hour < 4) >= 0.4
          ? 'night_owl'
          : share((w) => w.hour >= 4 && w.hour < 9) >= 0.4
            ? 'early_bird'
            : share((w) => w.hour >= 11 && w.hour < 14) >= 0.4
              ? 'lunch_learner'
              : share((w) => w.dow === 1 || w.dow === 7) >= 0.5
                ? 'weekend_warrior'
                : 'explorer';

  const badgeRows = await Achievement.find({ userId, earnedAt: range }).sort({ earnedAt: 1 }).lean();
  const titles = new Map(ACHIEVEMENTS.map((a) => [a.key, a.title]));
  const badges = badgeRows.map((b) => (b.key.startsWith('monthly_') ? monthlyBadge(b.key.slice(8).replace('_', '-')).title : (titles.get(b.key) ?? b.key)));

  const league = await LeagueMember.find({ userId, weekStart: { $gte: period.start, $lt: period.end }, finalRank: { $ne: null } }).select({ finalRank: 1, tier: 1, outcome: 1 }).lean();
  const bestLeague = [...league].sort((a, b) => (a.finalRank ?? 99) - (b.finalRank ?? 99))[0];
  const highFives = await HighFive.countDocuments({ fromId: userId, kind: 'high_five', createdAt: range });

  const enrollment = await Enrollment.findOne({ userId, status: { $ne: 'archived' } }).sort({ startedAt: 1 }).lean();
  const snapshots = enrollment
    ? await ScoreSnapshot.find({ enrollmentId: enrollment._id, date: { $gte: period.start, $lt: period.end } }).sort({ date: 1 }).select({ score: 1 }).lean()
    : [];
  const score = snapshots.length ? { start: snapshots[0]!.score, end: snapshots[snapshots.length - 1]!.score } : null;

  const answered = attempts[0]?.total ?? 0;
  const correct = attempts[0]?.correct ?? 0;
  const lessons = sessions.filter((s) => s.mode === 'lesson' || s.mode === 'checkpoint').length;
  const stories = sessions.filter((s) => s.mode === 'story').length;
  const mocks = sessions.filter((s) => s.mode === 'mock').length;
  const longest = longestRun(studyDates);
  const share_text = [
    `My CertPath ${period.kind === 'year' ? `${period.label} in review` : `${period.label} recap`}:`,
    `${studyDates.length} study ${studyDates.length === 1 ? 'day' : 'days'}, ${answered} ${answered === 1 ? 'question' : 'questions'} answered, ${xp} XP.`,
    longest > 1 ? `Longest streak: ${longest} days.` : '',
    `I'm a ${PERSONAS[persona].title.toLowerCase()}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    period: { kind: period.kind, label: period.label, start: period.start, end: period.end },
    empty: answered === 0 && studyDates.length === 0,
    study_days: studyDates.length,
    days_in_period: days,
    longest_streak: longest,
    answered,
    accuracy: answered ? Math.round((correct / answered) * 100) : null,
    xp,
    gems,
    minutes,
    lessons,
    stories,
    mocks,
    best_day: bestDay ? { date: bestDay._id, xp: bestDay.xp } : null,
    top_domain: topDomain?.title ?? null,
    persona: { key: persona, ...PERSONAS[persona] },
    badges,
    league: bestLeague ? { best_rank: bestLeague.finalRank, tier: bestLeague.tier, promotions: league.filter((l) => l.outcome === 'promoted').length } : null,
    high_fives: highFives,
    score,
    share_text,
  };
}
