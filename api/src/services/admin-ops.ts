import {
  AnalyticsEvent,
  Attempt,
  ContentAudit,
  DailyStudyDay,
  Enrollment,
  Entitlement,
  ExamOutcome,
  IssueReport,
  PracticeSession,
  QuestionVersion,
  User,
  type UserRecord,
} from '../models/index.js';
import { hashPassword } from '../auth/passwords.js';
import { track } from '../lib/analytics.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
import { PLUS_FEATURES, type FeatureKey } from '../lib/rules.js';
import { toEntitlement } from './access.js';
import { lowRatedFamilies } from './ratings.js';
import { audit } from './content-admin.js';
import { habitSummary, xpTotal } from './progress.js';
import { toProfile } from './account.js';

type Actor = Pick<UserRecord, '_id' | 'roles'>;

/**
 * Operating metrics, each with its denominator. Activity is measured by
 * qualifying sessions, not app opens or XP.
 */
export async function overview(now = new Date()) {
  const day = 86_400_000;
  const weekAgo = new Date(now.getTime() - 7 * day);
  const [learners, newLearners, weeklyActive, studyDays, sessionsByMode, answered, questionsByStatus, openIssues, previewStarts, outcomes, activated] =
    await Promise.all([
      User.countDocuments({ roles: 'learner', deletedAt: null }),
      User.countDocuments({ roles: 'learner', deletedAt: null, createdAt: { $gte: weekAgo } }),
      PracticeSession.distinct('userId', { qualifying: true, completedAt: { $gte: weekAgo } }).then((r) => r.length),
      DailyStudyDay.countDocuments({ earnedAt: { $gte: weekAgo } }),
      PracticeSession.aggregate<{ _id: string; n: number }>([
        { $match: { startedAt: { $gte: weekAgo } } },
        { $group: { _id: '$mode', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      Attempt.countDocuments({ submittedAt: { $gte: weekAgo } }),
      QuestionVersion.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      IssueReport.countDocuments({ status: 'open' }),
      Entitlement.distinct('userId', { source: 'preview', createdAt: { $gte: weekAgo } }).then((r) => r.length),
      ExamOutcome.aggregate<{ _id: { result: string; verification: string }; n: number }>([
        { $group: { _id: { result: '$result', verification: '$verificationStatus' }, n: { $sum: 1 } } },
      ]),
      // Activation: new learners this week who completed a first lesson within 24h of signup.
      User.aggregate<{ n: number }>([
        { $match: { roles: 'learner', deletedAt: null, createdAt: { $gte: weekAgo } } },
        {
          $lookup: {
            from: 'practicesessions',
            let: { uid: '$_id', created: '$createdAt' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$userId', '$$uid'] },
                      { $in: ['$mode', ['lesson', 'checkpoint']] },
                      { $eq: ['$status', 'completed'] },
                      { $lte: ['$completedAt', { $add: ['$$created', day] }] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'first',
          },
        },
        { $match: { 'first.0': { $exists: true } } },
        { $count: 'n' },
      ]),
    ]);
  return {
    window_days: 7,
    learners_total: learners,
    new_learners: newLearners,
    activation: { activated: activated[0]?.n ?? 0, cohort: newLearners },
    weekly_active_study: { learners: weeklyActive, of_total: learners },
    study_days_credited: studyDays,
    answers_submitted: answered,
    sessions_by_mode: sessionsByMode.map((r) => ({ mode: r._id, sessions: r.n })),
    questions_by_status: Object.fromEntries(questionsByStatus.map((r) => [r._id, r.n])),
    open_issues: openIssues,
    // Questions learners rate poorly, for the backoffice's attention queue.
    low_rated_questions: (await lowRatedFamilies()).length,
    preview_starts: previewStarts,
    outcomes: outcomes.map((o) => ({ result: o._id.result, verification_status: o._id.verification, count: o.n })),
  };
}

export async function listIssues(status?: 'open' | 'resolved' | 'dismissed') {
  const issues = await IssueReport.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean();
  const questions = new Map(
    (await QuestionVersion.find({ _id: { $in: issues.map((i) => i.questionVersionId) } }).select({ prompt: 1, status: 1, revision: 1 }).lean()).map((q) => [q._id, q]),
  );
  return issues.map((i) => ({
    id: i._id,
    question_version_id: i.questionVersionId,
    question_prompt: questions.get(i.questionVersionId)?.prompt ?? '',
    question_status: questions.get(i.questionVersionId)?.status ?? 'unknown',
    reason: i.reason,
    note: i.note,
    status: i.status,
    resolution: i.resolution,
    created_at: i.createdAt.toISOString(),
    resolved_at: i.resolvedAt?.toISOString() ?? null,
  }));
}

export async function updateIssue(actor: Actor, issueId: string, input: { status: 'open' | 'resolved' | 'dismissed'; resolution?: string }) {
  const issue = await IssueReport.findByIdAndUpdate(
    issueId,
    {
      $set: {
        status: input.status,
        resolution: input.resolution ?? '',
        ...(input.status === 'open' ? { resolvedBy: null, resolvedAt: null } : { resolvedBy: actor._id, resolvedAt: new Date() }),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!issue) throw notFound('Issue');
  await audit(actor, 'issue_report', issueId, `status_${input.status}`, input.resolution ?? '');
  return (await listIssues()).find((i) => i.id === issueId)!;
}

export async function listLearners(q?: string) {
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [{ displayName: rx }, { email: rx }, { _id: q }];
  }
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(100).lean<UserRecord[]>();
  return users.map((u) => ({ ...toProfile(u), created_at: u.createdAt.toISOString() }));
}

export async function learnerDetail(userId: string) {
  const user = await User.findById(userId).lean<UserRecord>();
  if (!user) throw notFound('Learner');
  const [habits, xp, enrollments, entitlements, outcomes, recentSessions] = await Promise.all([
    habitSummary(user._id, toProfile(user).timezone),
    xpTotal(user._id),
    Enrollment.find({ userId }).lean(),
    Entitlement.find({ userId }).sort({ createdAt: -1 }).lean(),
    ExamOutcome.find({ userId }).sort({ takenAt: -1 }).lean(),
    PracticeSession.find({ userId }).sort({ startedAt: -1 }).limit(20).select({ mode: 1, status: 1, startedAt: 1, questionCount: 1, completion: 1 }).lean(),
  ]);
  return {
    user: { ...toProfile(user), created_at: user.createdAt.toISOString() },
    streak: habits,
    xp_total: xp,
    enrollments: enrollments.map((e) => ({ id: e._id, exam_version_id: e.examVersionId, status: e.status, exam_date: e.examDate ?? null })),
    entitlements: entitlements.map((e) => ({
      id: e._id,
      ...toEntitlement(e),
      source_ref: e.source === 'manual' ? e.sourceRef : undefined,
      revoked_at: e.revokedAt?.toISOString() ?? null,
    })),
    outcomes: outcomes.map((o) => ({ id: o._id, result: o.result, taken_at: o.takenAt.toISOString(), verification_status: o.verificationStatus })),
    recent_sessions: recentSessions.map((s) => ({
      id: s._id,
      mode: s.mode,
      status: s.status,
      started_at: s.startedAt.toISOString(),
      question_count: s.questionCount,
      correct: (s.completion as { correct?: number } | null)?.correct ?? null,
    })),
  };
}

/** Support grants are explicit, dated and audited. */
export async function grantEntitlement(actor: Actor, userId: string, input: { features: FeatureKey[]; days: number; note: string }) {
  if (!(await User.exists({ _id: userId }))) throw notFound('Learner');
  const features = input.features.length ? input.features : [...PLUS_FEATURES];
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + input.days * 86_400_000);
  const sourceRef = `manual:${uuid()}`;
  for (const featureKey of features) {
    await Entitlement.create({ userId, featureKey, source: 'manual', sourceRef, startsAt, endsAt });
  }
  await audit(actor, 'entitlement', userId, 'granted', input.note, { features, days: input.days });
  track('entitlement_changed', { userId, properties: { source: 'manual', change: 'granted' } });
  return learnerDetail(userId);
}

export async function revokeEntitlement(actor: Actor, entitlementId: string, note: string) {
  const ent = await Entitlement.findById(entitlementId);
  if (!ent) throw notFound('Entitlement');
  if (ent.revokedAt) throw conflict('already_revoked', 'This entitlement is already revoked');
  ent.revokedAt = new Date();
  await ent.save();
  await audit(actor, 'entitlement', ent.userId, 'revoked', note, { entitlement_id: ent._id, feature: ent.featureKey });
  track('entitlement_changed', { userId: ent.userId, properties: { source: ent.source, change: 'revoked' } });
  return learnerDetail(ent.userId);
}

export async function listStaff() {
  const staff = await User.find({ roles: { $in: ['reviewer', 'admin'] }, deletedAt: null, externalSubject: { $not: /^system:/ } })
    .sort({ createdAt: 1 })
    .lean<UserRecord[]>();
  return staff.map((u) => ({ id: u._id, display_name: u.displayName, email: u.email ?? null, roles: u.roles, created_at: u.createdAt.toISOString() }));
}

/** Staff accounts are created by an admin, never self-registered. */
export async function createStaff(actor: Actor, input: { email: string; display_name: string; password: string; admin: boolean }) {
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email })) throw conflict('email_taken', 'An account with this email already exists');
  const id = uuid();
  await User.create({
    _id: id,
    externalSubject: `local:${id}`,
    email,
    passwordHash: await hashPassword(input.password),
    isGuest: false,
    roles: input.admin ? ['admin', 'reviewer'] : ['reviewer'],
    displayName: input.display_name.trim(),
  });
  await audit(actor, 'user', id, 'staff_created', '', { admin: input.admin });
  return (await listStaff()).find((s) => s.id === id)!;
}

export async function listOutcomes() {
  const rows = await ExamOutcome.find().sort({ createdAt: -1 }).limit(200).lean();
  const users = new Map((await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select({ displayName: 1 }).lean()).map((u) => [u._id, u.displayName]));
  return rows.map((o) => ({
    id: o._id,
    learner: users.get(o.userId) ?? 'Removed member',
    user_id: o.userId,
    result: o.result,
    taken_at: o.takenAt.toISOString(),
    verification_status: o.verificationStatus,
  }));
}

/** "Passed" stays self-reported unless staff verify evidence. */
export async function verifyOutcome(actor: Actor, outcomeId: string, status: 'self_reported' | 'evidence_received' | 'verified') {
  const outcome = await ExamOutcome.findById(outcomeId);
  if (!outcome) throw notFound('Outcome');
  outcome.verificationStatus = status;
  if (status === 'verified') {
    outcome.verifiedBy = actor._id;
    outcome.verifiedAt = new Date();
  } else {
    outcome.verifiedBy = null;
    outcome.verifiedAt = null;
  }
  await outcome.save();
  await audit(actor, 'exam_outcome', outcomeId, `verification_${status}`);
  return { id: outcome._id, result: outcome.result, verification_status: outcome.verificationStatus };
}

export async function auditLog(filter: { entity_type?: string; entity_id?: string }) {
  const query: Record<string, unknown> = {};
  if (filter.entity_type) query.entityType = filter.entity_type;
  if (filter.entity_id) query.entityId = filter.entity_id;
  const rows = await ContentAudit.find(query).sort({ recordedAt: -1 }).limit(300).lean();
  const actors = new Map((await User.find({ _id: { $in: [...new Set(rows.map((r) => r.actorId))] } }).select({ displayName: 1, email: 1 }).lean()).map((u) => [u._id, u]));
  return rows.map((r) => ({
    id: r._id,
    actor: actors.get(r.actorId)?.displayName ?? r.actorId,
    entity_type: r.entityType,
    entity_id: r.entityId,
    action: r.action,
    note: r.note,
    details: r.details,
    recorded_at: r.recordedAt.toISOString(),
  }));
}

export async function eventCounts(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await AnalyticsEvent.aggregate<{ _id: string; n: number }>([
    { $match: { occurredAt: { $gte: since } } },
    { $group: { _id: '$eventName', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  return rows.map((r) => ({ event: r._id, count: r.n }));
}

export function parseFeatures(features: string[]): FeatureKey[] {
  const allowed = new Set<string>(PLUS_FEATURES);
  if (features.some((f) => !allowed.has(f))) throw badRequest('invalid_feature', 'Unknown feature key');
  return features as FeatureKey[];
}
