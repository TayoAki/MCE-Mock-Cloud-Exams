import { DateTime } from 'luxon';
import { tx } from '../db.js';
import { EngagementProfile, LeagueCohort, LeagueMember, RewardLedger, User } from '../models/index.js';
import { GEMS, LEAGUE_COHORT_SIZE, LEAGUE_TIERS, SOLO_PROMOTION_XP, leagueZones, type LeagueTier } from '../lib/rules.js';
import { sha256 } from '../lib/ids.js';
import { awardAchievement } from './achievements.js';
import { celebrate, earnGems, ensureProfile } from './wallet.js';

/** League weeks run Monday 00:00 to Monday 00:00 UTC for everyone, so a cohort shares one deadline. */
export function leagueWeek(now: Date) {
  const start = DateTime.fromJSDate(now, { zone: 'utc' }).startOf('week');
  return { weekStart: start.toISODate()!, startsAt: start.toJSDate(), endsAt: start.plus({ weeks: 1 }).toJSDate() };
}

async function weeklyXp(userId: string, now: Date) {
  const { startsAt, endsAt } = leagueWeek(now);
  const rows = await RewardLedger.aggregate<{ xp: number }>([
    { $match: { userId, createdAt: { $gte: startsAt, $lt: endsAt } } },
    { $group: { _id: null, xp: { $sum: '$amount' } } },
  ]);
  return rows[0]?.xp ?? 0;
}

type Member = { _id: unknown; xp: number; updatedAt?: Date | null };
/** Higher XP ranks first; on a tie, whoever got there first. */
async function rankIn(cohortId: string, me: Member) {
  const ahead = await LeagueMember.countDocuments({
    cohortId,
    hidden: false,
    _id: { $ne: me._id },
    $or: [{ xp: { $gt: me.xp } }, { xp: me.xp, updatedAt: { $lt: me.updatedAt ?? new Date() } }],
  });
  return ahead + 1;
}

export interface LeagueStanding {
  tier: LeagueTier;
  rank: number;
  previous_rank: number | null;
  size: number;
  xp: number;
  week_start: string;
  ends_at: string;
  promote: number;
  demote: number;
}

/** The oldest cohort in the tier with room this week, or a new one. */
async function joinCohort(userId: string, weekStart: string, tier: LeagueTier) {
  const open = await LeagueCohort.findOneAndUpdate(
    { weekStart, tier, size: { $lt: LEAGUE_COHORT_SIZE }, closedAt: null },
    { $inc: { size: 1 } },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  );
  const cohortId = open ? open._id : (await LeagueCohort.create([{ weekStart, tier, size: 1 }]))[0]!._id;
  return (await LeagueMember.create([{ userId, weekStart, cohortId, tier }]))[0]!;
}

/** Places the learner in a cohort on their first XP of the week and records this week's XP. Runs in a transaction. */
export async function recordLeagueXp(userId: string, now: Date): Promise<LeagueStanding | null> {
  const profile = await ensureProfile(userId);
  if (profile.leagueHidden) return null;
  const xp = await weeklyXp(userId, now);
  if (xp <= 0) return null;
  const { weekStart, endsAt } = leagueWeek(now);
  const existing = await LeagueMember.findOne({ userId, weekStart });
  const previousRank = existing ? await rankIn(existing.cohortId, existing) : null;
  const member = existing ?? (await joinCohort(userId, weekStart, profile.leagueTier as LeagueTier));
  member.xp = xp;
  member.updatedAt = now;
  await member.save();
  const size = await LeagueMember.countDocuments({ cohortId: member.cohortId, hidden: false });
  const zones = leagueZones(size, LEAGUE_TIERS.indexOf(member.tier as LeagueTier));
  return {
    tier: member.tier as LeagueTier,
    rank: await rankIn(member.cohortId, member),
    previous_rank: previousRank,
    size,
    xp,
    week_start: weekStart,
    ends_at: endsAt.toISOString(),
    promote: zones.promote,
    demote: zones.demote,
  };
}

/** What other learners see: a registered learner's display name, or an anonymous handle for guests. */
export function publicName(user: { _id: string; displayName?: string | null; isGuest?: boolean }) {
  if (!user.isGuest && user.displayName) return user.displayName;
  return `Learner ${parseInt(sha256(user._id).slice(0, 6), 16) % 10000}`;
}

/** The current week's table, or the learner's tier and how to join. */
export async function leagueView(userId: string, now = new Date()) {
  const profile = await ensureProfile(userId);
  const { weekStart, endsAt } = leagueWeek(now);
  const last = await LeagueMember.findOne({ userId, weekStart: { $lt: weekStart }, outcome: { $ne: null } }).sort({ weekStart: -1 }).lean();
  const base = {
    tier: profile.leagueTier as LeagueTier,
    tiers: LEAGUE_TIERS,
    hidden: profile.leagueHidden,
    week_start: weekStart,
    ends_at: endsAt.toISOString(),
    last_result: last ? { week_start: last.weekStart, tier: last.tier, rank: last.finalRank, outcome: last.outcome } : null,
  };
  const me = await LeagueMember.findOne({ userId, weekStart }).lean();
  if (!me || profile.leagueHidden) return { ...base, joined: false as const, rows: [], promote: 0, demote: 0 };
  const members = await LeagueMember.find({ cohortId: me.cohortId, hidden: false }).sort({ xp: -1, updatedAt: 1 }).lean();
  const users = new Map(
    (await User.find({ _id: { $in: members.map((m) => m.userId) } }).select({ displayName: 1, isGuest: 1 }).lean()).map((u) => [u._id, u]),
  );
  const zones = leagueZones(members.length, LEAGUE_TIERS.indexOf(me.tier as LeagueTier));
  return {
    ...base,
    tier: me.tier as LeagueTier,
    joined: true as const,
    promote: zones.promote,
    demote: zones.demote,
    rows: members.map((m, i) => {
      const u = users.get(m.userId);
      return {
        rank: i + 1,
        name: u ? publicName(u) : 'Learner',
        xp: m.xp,
        is_me: m.userId === userId,
        zone: i < zones.promote ? 'promote' : zones.demote && i >= members.length - zones.demote ? 'demote' : null,
      };
    }),
  };
}

/** Hiding takes the learner out of this week's table and future ones until they turn it back on. */
export async function setLeagueHidden(userId: string, hidden: boolean, now = new Date()) {
  await ensureProfile(userId);
  await EngagementProfile.updateOne({ _id: userId }, { $set: { leagueHidden: hidden } });
  await LeagueMember.updateOne({ userId, weekStart: leagueWeek(now).weekStart }, { $set: { hidden } });
}

/** Closes finished weeks: ranks each cohort once, moves learners between tiers and pays the podium. */
export async function closeLeagueWeeks(now = new Date()) {
  const { weekStart: current } = leagueWeek(now);
  const due = await LeagueCohort.find({ weekStart: { $lt: current }, closedAt: null }).select({ _id: 1 }).limit(50).lean();
  for (const { _id } of due) {
    await tx(async () => {
      const cohort = await LeagueCohort.findOneAndUpdate({ _id, closedAt: null }, { $set: { closedAt: now } }, { returnDocument: 'after' });
      if (!cohort) return;
      const tierIndex = LEAGUE_TIERS.indexOf(cohort.tier as LeagueTier);
      const members = await LeagueMember.find({ cohortId: cohort._id, hidden: false }).sort({ xp: -1, updatedAt: 1 });
      const size = members.length;
      const zones = leagueZones(size, tierIndex);
      for (const [i, m] of members.entries()) {
        const rank = i + 1;
        const promoted = m.xp > 0 && rank <= zones.promote && (size >= 2 || m.xp >= SOLO_PROMOTION_XP);
        const demoted = !promoted && zones.demote > 0 && rank > size - zones.demote;
        const outcome = promoted ? 'promoted' : demoted ? 'demoted' : 'stayed';
        const newTier = LEAGUE_TIERS[tierIndex + (promoted ? 1 : demoted ? -1 : 0)]!;
        m.finalRank = rank;
        m.outcome = outcome;
        await m.save();
        await EngagementProfile.updateOne({ _id: m.userId }, { $set: { leagueTier: newTier } });
        const podium = size >= 3 && m.xp > 0 && rank <= 3;
        const gems = podium ? await earnGems(m.userId, GEMS.leagueRank[rank - 1]!, 'league_reward', `league:${cohort.weekStart}`) : 0;
        await celebrate(m.userId, 'league_result', { tier: cohort.tier, rank, size, outcome, new_tier: newTier, gems, week_start: cohort.weekStart }, `league:${cohort.weekStart}`);
        if (promoted) await awardAchievement(m.userId, 'league_promoted');
        if (podium) await awardAchievement(m.userId, 'league_top3');
        if (podium && rank === 1) await awardAchievement(m.userId, 'league_winner');
      }
    });
  }
  return due.length;
}
