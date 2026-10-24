import { tx } from '../db.js';
import { CircleInvite, CircleMember, CircleWeek, PracticeSession, StudyCircle, User, type UserRecord } from '../models/index.js';
import { config } from '../config.js';
import { track } from '../lib/analytics.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { randomToken, sha256, uuid } from '../lib/ids.js';
import { isValidZone, localDate, localWeek } from '../lib/time.js';

/** Phase 2: private weekly study-day circles. Learning never depends on them. */
export async function createCircle(user: UserRecord, input: { name: string; timezone: string; weekly_target_days: number }) {
  if (user.isGuest) throw forbidden('account_required', 'Create an account before starting a circle');
  if (!isValidZone(input.timezone)) throw badRequest('invalid_timezone', 'Use an IANA timezone');
  const circle = await StudyCircle.create({
    ownerId: user._id,
    name: input.name.trim(),
    timezone: input.timezone,
    weeklyTargetDays: input.weekly_target_days,
  });
  await CircleMember.create({ circleId: circle._id, userId: user._id, role: 'owner' });
  return circleView(user._id, circle._id);
}

async function activeMembership(userId: string, circleId: string) {
  const member = await CircleMember.findOne({ circleId, userId, status: 'active' }).lean();
  if (!member) throw notFound('Circle');
  return member;
}

/** The week's timezone and target are fixed when it opens. */
async function currentWeek(circle: { _id: string; timezone: string; weeklyTargetDays: number }, now: Date) {
  const week = localWeek(now, circle.timezone);
  await CircleWeek.updateOne(
    { circleId: circle._id, startsAt: week.startsAt },
    { $setOnInsert: { _id: uuid(), endsAt: week.endsAt, timezoneSnapshot: circle.timezone, targetDays: circle.weeklyTargetDays } },
    { upsert: true },
  );
  return CircleWeek.findOne({ circleId: circle._id, startsAt: week.startsAt }).lean();
}

/**
 * Members score distinct circle-local dates with a qualifying, server-finalized
 * session while their membership was active; max seven. Plans score identically.
 */
export async function circleView(userId: string, circleId: string, now = new Date()) {
  await activeMembership(userId, circleId);
  const circle = await StudyCircle.findById(circleId).lean();
  if (!circle || circle.status !== 'active') throw notFound('Circle');
  const week = (await currentWeek(circle, now))!;
  const members = await CircleMember.find({ circleId, status: 'active' }).sort({ joinedAt: 1 }).lean();
  const users = new Map(
    (await User.find({ _id: { $in: members.map((m) => m.userId) } }).select({ displayName: 1, deletedAt: 1 }).lean()).map((u) => [u._id, u]),
  );
  const roster = [];
  for (const m of members) {
    const from = m.joinedAt > week.startsAt ? m.joinedAt : week.startsAt;
    const sessions = await PracticeSession.find({
      userId: m.userId,
      qualifying: true,
      completedAt: { $gte: from, $lt: week.endsAt },
    })
      .select({ completedAt: 1 })
      .lean();
    const days = new Set(sessions.map((s) => localDate(s.completedAt!, week.timezoneSnapshot)));
    const u = users.get(m.userId);
    roster.push({
      display_name: u && !u.deletedAt ? u.displayName : 'Removed member',
      study_days: Math.min(days.size, 7),
      is_you: m.userId === userId,
      role: m.role,
    });
  }
  return {
    id: circle._id,
    name: circle.name,
    timezone: week.timezoneSnapshot,
    weekly_target_days: week.targetDays,
    week_starts_at: week.startsAt.toISOString(),
    week_ends_at: week.endsAt.toISOString(),
    members: roster,
    note: 'One study day counts once. No XP race.',
  };
}

export async function myCircles(userId: string) {
  const memberships = await CircleMember.find({ userId, status: 'active' }).lean();
  const circles = await StudyCircle.find({ _id: { $in: memberships.map((m) => m.circleId) }, status: 'active' }).lean();
  return circles.map((c) => ({ id: c._id, name: c.name, weekly_target_days: c.weeklyTargetDays }));
}

export async function createInvite(user: UserRecord, circleId: string) {
  await activeMembership(user._id, circleId);
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  await CircleInvite.create({ circleId, inviterId: user._id, tokenHash: sha256(token), expiresAt });
  track('circle_invite_requested', { userId: user._id });
  return { invite_url: `${config.INVITE_URL_BASE}?token=${encodeURIComponent(token)}`, expires_at: expiresAt.toISOString() };
}

/** Joining requires a valid, unexpired, unrevoked invite from a still-active member. */
export async function joinCircle(user: UserRecord, token: string) {
  if (user.isGuest) throw forbidden('account_required', 'Create an account before joining a circle');
  const circleId = await tx(async () => {
    const now = new Date();
    const invite = await CircleInvite.findOneAndUpdate(
      { tokenHash: sha256(token), revokedAt: null, expiresAt: { $gt: now }, $expr: { $lt: ['$useCount', '$maxUses'] } },
      { $inc: { useCount: 1 } },
      { returnDocument: 'after' },
    ).lean();
    if (!invite) throw conflict('invite_invalid', 'This invite has expired, was revoked or is used up');
    const inviter = await CircleMember.findOne({ circleId: invite.circleId, userId: invite.inviterId, status: 'active' }).lean();
    const circle = await StudyCircle.findOne({ _id: invite.circleId, status: 'active' }).lean();
    if (!inviter || !circle) throw conflict('invite_invalid', 'This invite is no longer valid');
    await CircleMember.updateOne(
      { circleId: invite.circleId, userId: user._id },
      { $set: { status: 'active', leftAt: null, joinedAt: now }, $setOnInsert: { role: 'member' } },
      { upsert: true },
    );
    return invite.circleId;
  });
  return circleView(user._id, circleId);
}

export async function leaveCircle(user: UserRecord, circleId: string) {
  const member = await activeMembership(user._id, circleId);
  if (member.role === 'owner') {
    const others = await CircleMember.countDocuments({ circleId, status: 'active', userId: { $ne: user._id } });
    if (others > 0) throw conflict('owner_must_transfer', 'Transfer ownership or archive the circle before leaving');
    await StudyCircle.updateOne({ _id: circleId }, { $set: { status: 'archived' } });
  }
  await CircleMember.updateOne({ circleId, userId: user._id }, { $set: { status: 'left', leftAt: new Date() } });
  return { left: true };
}
