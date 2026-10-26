import { DateTime } from 'luxon';
import {
  DailyQuestSet,
  DailyStudyDay,
  EngagementProfile,
  Enrollment,
  Exam,
  FriendStreak,
  LeagueMember,
  NotificationJob,
  PracticeSession,
  ReminderArm,
  StreakState,
  User,
} from '../models/index.js';
import { LEAGUE_TIERS, STREAK_MILESTONES, WAGER_DAYS, displayedStreak, leagueZones, levelFor, type LeagueTier, type QuestMetric } from '../lib/rules.js';
import { daysBetween } from '../lib/time.js';
import { leagueWeek, publicName } from './leagues.js';
import { xpTotal } from './progress.js';
import { questMetrics } from './quests.js';

/**
 * Picks the wording of each reminder per learner with a multi-armed bandit.
 *
 * Every template is an arm. Its shared results across all learners form a
 * Beta prior (capped at PRIOR_STRENGTH pseudo-sends so one popular template
 * cannot drown out a learner's own history), the learner's own sends and
 * conversions update it, and Thompson sampling draws a score per template.
 * A template sent recently is penalised so the same words don't repeat day
 * after day, and only templates whose facts are true for the learner right
 * now (a streak to protect, a friend waiting, a quest nearly done) compete.
 * A reminder converts when the learner earns a study day within six hours.
 */

export interface ReminderContext {
  name: string | null;
  streak: number;
  longest: number;
  freezes: number;
  wagerDay: number | null;
  quest: { label: string; remaining: number } | null;
  league: { rank: number; tier: LeagueTier; size: number; promote: number; demote: number } | null;
  friend: { name: string; days: number } | null;
  exam: { title: string; daysLeft: number } | null;
  level: { next: number; toGo: number } | null;
}

interface Template {
  key: string;
  /** Eligible for the evening streak saver, which only speaks when something is at stake. */
  urgent?: boolean;
  when: (c: ReminderContext) => boolean;
  render: (c: ReminderContext) => { title: string; body: string };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tierName = (t: LeagueTier) => t[0]!.toUpperCase() + t.slice(1);

export const REMINDER_TEMPLATES: Template[] = [
  { key: 'gentle', when: () => true, render: () => ({ title: 'A little practice today?', body: 'Your next five questions are ready when you are.' }) },
  { key: 'two_minutes', when: () => true, render: () => ({ title: 'Got five minutes?', body: 'One short lesson is all today needs.' }) },
  {
    key: 'by_name',
    when: (c) => !!c.name,
    render: (c) => ({ title: `${c.name}, five questions?`, body: 'Your path is right where you left it.' }),
  },
  {
    key: 'streak_alive',
    urgent: true,
    when: (c) => c.streak >= 1,
    render: (c) => ({ title: `Keep your ${plural(c.streak, 'day')} streak alive`, body: 'One lesson before midnight keeps the flame going.' }),
  },
  {
    key: 'streak_milestone',
    urgent: true,
    when: (c) => (STREAK_MILESTONES as readonly number[]).includes(c.streak + 1),
    render: (c) => ({ title: `Day ${c.streak + 1} is a milestone`, body: `Study today to earn your ${c.streak + 1}-day streak badge.` }),
  },
  {
    key: 'freeze_standby',
    when: (c) => c.freezes > 0 && c.streak >= 3,
    render: (c) => ({ title: 'Your streak freeze is on standby', body: `But a quick lesson keeps all ${c.streak} days truly earned.` }),
  },
  {
    key: 'wager',
    urgent: true,
    when: (c) => c.wagerDay !== null,
    render: (c) => ({ title: `Day ${c.wagerDay} of ${WAGER_DAYS} on your wager`, body: 'Study today to stay on track to double your gems.' }),
  },
  {
    key: 'quest_close',
    when: (c) => !!c.quest,
    render: (c) => ({ title: `So close: ${c.quest!.label.toLowerCase()}`, body: `${c.quest!.remaining} more to finish today's quest.` }),
  },
  {
    key: 'league_climb',
    when: (c) => !!c.league && c.league.rank > 1 && !(c.league.demote && c.league.rank > c.league.size - c.league.demote),
    render: (c) => ({
      title: `You're #${c.league!.rank} in ${tierName(c.league!.tier)} League`,
      body: c.league!.rank > c.league!.promote ? 'A lesson now could move you into the promotion zone.' : 'Hold your spot: others are studying too.',
    }),
  },
  {
    key: 'league_danger',
    urgent: true,
    when: (c) => !!c.league && c.league.demote > 0 && c.league.rank > c.league.size - c.league.demote,
    render: (c) => ({ title: `You're in the ${tierName(c.league!.tier)} demotion zone`, body: 'One lesson could lift you out of it.' }),
  },
  {
    key: 'friend_waiting',
    urgent: true,
    when: (c) => !!c.friend,
    render: (c) => ({ title: `${c.friend!.name} studied today`, body: `Study now to keep your ${plural(c.friend!.days, 'day')} friend streak going.` }),
  },
  {
    key: 'exam_countdown',
    when: (c) => !!c.exam && c.exam.daysLeft >= 1 && c.exam.daysLeft <= 120,
    render: (c) => ({ title: `${plural(c.exam!.daysLeft, 'day')} to your ${c.exam!.title} exam`, body: 'Five questions today means less cramming later.' }),
  },
  {
    key: 'level_close',
    when: (c) => !!c.level,
    render: (c) => ({ title: `${c.level!.toGo} XP to level ${c.level!.next}`, body: 'One lesson gets you most of the way there.' }),
  },
  {
    key: 'comeback',
    when: (c) => c.streak === 0 && c.longest >= 3,
    render: (c) => ({ title: `Your record is ${plural(c.longest, 'day')}`, body: 'Start a new streak today. Day one is the hardest.' }),
  },
];

export const FRIEND_NUDGE_KEY = 'friend_nudge';
const CONVERSION_WINDOW_MS = 6 * 3_600_000;
const PRIOR_STRENGTH = 20;

/** Everything the templates may mention, read without writing anything. */
export async function reminderContext(userId: string, today: string, zone: string, now = new Date()): Promise<ReminderContext> {
  const user = await User.findById(userId).select({ displayName: 1, isGuest: 1 }).lean();
  const streak = await StreakState.findById(userId).lean();
  const state = {
    lastStudyDate: streak?.lastStudyDate ?? null,
    lastCoveredDate: streak?.lastCoveredDate ?? null,
    currentDays: streak?.currentDays ?? 0,
    longestDays: streak?.longestDays ?? 0,
  };
  const profile = await EngagementProfile.findById(userId).lean();
  const wager = profile?.wager?.status === 'active' ? profile.wager : null;

  let quest: ReminderContext['quest'] = null;
  const set = await DailyQuestSet.findOne({ userId, date: today }).lean();
  if (set) {
    const metrics = await questMetrics(userId, today, zone);
    const open = set.quests
      .filter((q) => !q.completedAt && metrics[q.metric as QuestMetric] > 0)
      .map((q) => ({ label: q.label, remaining: q.target - metrics[q.metric as QuestMetric] }))
      .filter((q) => q.remaining > 0)
      .sort((a, b) => a.remaining - b.remaining);
    quest = open[0] ?? null;
  }

  let league: ReminderContext['league'] = null;
  const member = await LeagueMember.findOne({ userId, weekStart: leagueWeek(now).weekStart, hidden: false }).lean();
  if (member) {
    const size = await LeagueMember.countDocuments({ cohortId: member.cohortId, hidden: false });
    const ahead = await LeagueMember.countDocuments({ cohortId: member.cohortId, hidden: false, xp: { $gt: member.xp } });
    const zones = leagueZones(size, LEAGUE_TIERS.indexOf(member.tier as LeagueTier));
    league = { rank: ahead + 1, tier: member.tier as LeagueTier, size, promote: zones.promote, demote: zones.demote };
  }

  let friend: ReminderContext['friend'] = null;
  for (const s of await FriendStreak.find({ pair: userId, status: 'active' }).lean()) {
    const other = s.pair.find((p) => p !== userId)!;
    if (s.currentDays > 0 && (await DailyStudyDay.exists({ userId: other, studyDate: today }))) {
      const u = await User.findById(other).select({ displayName: 1, isGuest: 1 }).lean();
      friend = { name: u ? publicName(u) : 'Your friend', days: s.currentDays };
      break;
    }
  }

  let exam: ReminderContext['exam'] = null;
  const enrollment = await Enrollment.findOne({ userId, status: 'active', examDate: { $ne: null } }).lean();
  if (enrollment?.examDate) {
    const e = await Exam.findById(enrollment.examId).select({ title: 1 }).lean();
    if (e) exam = { title: e.title, daysLeft: daysBetween(today, enrollment.examDate) };
  }

  const xp = await xpTotal(userId);
  const lv = levelFor(xp);
  return {
    name: user && !user.isGuest && user.displayName ? user.displayName.split(' ')[0]! : null,
    streak: displayedStreak(state, today),
    longest: state.longestDays,
    freezes: profile?.freezes ?? 0,
    wagerDay: wager ? daysBetween(wager.startedOn, today) + 1 : null,
    quest,
    league,
    friend,
    exam,
    level: lv.next - xp <= 60 ? { next: lv.level + 1, toGo: lv.next - xp } : null,
  };
}

/** Marsaglia and Tsang's gamma sampler; shape ≥ 1 here because every Beta parameter is ≥ 1. */
function sampleGamma(shape: number, rng: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      // Box-Muller standard normal.
      x = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rng: () => number = Math.random) {
  const x = sampleGamma(a, rng);
  return x / (x + sampleGamma(b, rng));
}

/** 0 when sent within the last day, recovering to ½ after one day, ¾ after two, and so on. */
export function recencyFactor(lastSentAt: Date | null, now: Date) {
  if (!lastSentAt) return 1;
  const days = (now.getTime() - lastSentAt.getTime()) / 86_400_000;
  return days < 1 ? 0.05 : 1 - Math.pow(0.5, days);
}

export async function pickTemplate(userId: string, ctx: ReminderContext, opts: { urgent?: boolean; now?: Date; rng?: () => number } = {}) {
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? Math.random;
  let eligible = REMINDER_TEMPLATES.filter((t) => (!opts.urgent || t.urgent) && t.when(ctx));
  if (!eligible.length) eligible = REMINDER_TEMPLATES.filter((t) => t.key === 'gentle');
  const keys = eligible.map((t) => t.key);
  const arms = new Map((await ReminderArm.find({ _id: { $in: keys } }).lean()).map((a) => [a._id, a]));
  const history = await NotificationJob.find({ userId, status: 'sent', templateKey: { $in: keys } })
    .select({ templateKey: 1, sentAt: 1, convertedAt: 1 })
    .sort({ sentAt: -1 })
    .limit(300)
    .lean();
  let best = eligible[0]!;
  let bestScore = -1;
  for (const t of eligible) {
    const shared = arms.get(t.key);
    const sent = shared?.sent ?? 0;
    const converted = Math.min(sent, shared?.converted ?? 0);
    const k = Math.min(1, PRIOR_STRENGTH / Math.max(1, sent));
    const mine = history.filter((h) => h.templateKey === t.key);
    const mineConverted = mine.filter((h) => h.convertedAt).length;
    const a = 1 + converted * k + mineConverted;
    const b = 1 + (sent - converted) * k + (mine.length - mineConverted);
    const score = sampleBeta(a, b, rng) * recencyFactor(mine[0]?.sentAt ?? null, now);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** Credits the most recent reminder sent in the last six hours when the learner earns a study day. */
export async function creditReminder(userId: string, now = new Date()) {
  const job = await NotificationJob.findOneAndUpdate(
    { userId, status: 'sent', convertedAt: null, sentAt: { $gte: new Date(now.getTime() - CONVERSION_WINDOW_MS), $lte: now } },
    { $set: { convertedAt: now } },
    { sort: { sentAt: -1 }, returnDocument: 'after' },
  );
  if (job?.templateKey) await ReminderArm.updateOne({ _id: job.templateKey }, { $inc: { converted: 1 }, $set: { updatedAt: now } }, { upsert: true });
  return job?.templateKey ?? null;
}

export async function recordSent(templateKey: string, now = new Date()) {
  await ReminderArm.updateOne({ _id: templateKey }, { $inc: { sent: 1 }, $set: { updatedAt: now } }, { upsert: true });
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Half an hour before the learner usually finishes a session, from the last
 * three weeks, kept between 08:00 and 21:30. Null until there are three sessions.
 */
export async function smartTime(userId: string, zone: string, now = new Date()) {
  const rows = await PracticeSession.find({ userId, status: 'completed', completedAt: { $gte: new Date(now.getTime() - 21 * 86_400_000) } })
    .select({ completedAt: 1 })
    .sort({ completedAt: -1 })
    .limit(60)
    .lean();
  if (rows.length < 3) return null;
  const minutes = rows.map((r) => {
    const t = DateTime.fromJSDate(r.completedAt!, { zone });
    return t.hour * 60 + t.minute;
  });
  minutes.sort((a, b) => a - b);
  const median = minutes[Math.floor(minutes.length / 2)]!;
  return hhmm(Math.min(21 * 60 + 30, Math.max(8 * 60, median - 30)));
}

/** The streak saver goes out an hour before quiet hours, no later than 22:00, and well after the first reminder. */
export function saverTime(firstTime: string, quietStart: string) {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const quiet = toMin(quietStart);
  const latest = quiet >= 12 * 60 ? Math.min(22 * 60, quiet - 60) : 22 * 60;
  return latest - toMin(firstTime) >= 90 ? hhmm(latest) : null;
}

/** Shared results per template, for the backoffice. */
export async function reminderStats() {
  const arms = new Map((await ReminderArm.find().lean()).map((a) => [a._id, a]));
  const sample: ReminderContext = {
    name: 'Alex',
    streak: 6,
    longest: 12,
    freezes: 1,
    wagerDay: 3,
    quest: { label: 'Get 8 answers right', remaining: 3 },
    league: { rank: 4, tier: 'silver', size: 30, promote: 6, demote: 4 },
    friend: { name: 'Sam', days: 5 },
    exam: { title: 'Databricks Data Engineer Associate', daysLeft: 21 },
    level: { next: 6, toGo: 40 },
  };
  return [...REMINDER_TEMPLATES.map((t) => ({ key: t.key, urgent: !!t.urgent, example: t.render(sample) })), { key: FRIEND_NUDGE_KEY, urgent: false, example: nudgeCopy('Sam') }].map(
    (t) => {
      const a = arms.get(t.key);
      const sent = a?.sent ?? 0;
      const converted = a?.converted ?? 0;
      return { ...t, sent, converted, rate: sent ? converted / sent : null };
    },
  );
}

export function nudgeCopy(from: string) {
  return { title: `${from} nudged you`, body: "They're cheering you on. One lesson keeps you both going." };
}
