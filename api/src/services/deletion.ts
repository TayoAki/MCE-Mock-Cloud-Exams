import { config } from '../config.js';
import {
  AiUsage,
  AnalyticsEvent,
  Attempt,
  Achievement,
  Celebration,
  CircleInvite,
  CircleMember,
  DailyQuestSet,
  DailyStudyDay,
  EngagementProfile,
  FriendStreak,
  GemLedger,
  HighFive,
  LeagueMember,
  ProtectedDay,
  Enrollment,
  Entitlement,
  ExamOutcome,
  IdempotencyRecord,
  IssueReport,
  LessonProgress,
  NotificationJob,
  NotificationPreference,
  ObjectiveProgress,
  PracticeSession,
  PushToken,
  QuestionExposure,
  ReviewQueue,
  RewardLedger,
  StoreEvent,
  StreakState,
  User,
} from '../models/index.js';
import { sha256 } from '../lib/ids.js';

/**
 * Dependency-aware deletion after the grace period. Learning records, social
 * identity and analytics are removed; verified store events keep a hashed owner
 * reference for billing retention. Staff audit entries keep their actor id.
 */
export async function deleteUserData(userId: string) {
  await NotificationJob.deleteMany({ userId });
  await NotificationPreference.deleteOne({ _id: userId });
  await PushToken.deleteMany({ userId });
  await CircleInvite.updateMany({ inviterId: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await CircleMember.updateMany({ userId }, { $set: { status: 'removed', leftAt: new Date() } });
  for (const model of [Attempt, QuestionExposure, ObjectiveProgress, ReviewQueue, LessonProgress, PracticeSession, DailyStudyDay, RewardLedger, ExamOutcome, IssueReport, IdempotencyRecord, AiUsage, Entitlement, Enrollment] as const) {
    await (model as typeof Attempt).deleteMany({ userId });
  }
  await StreakState.deleteOne({ _id: userId });
  for (const model of [GemLedger, ProtectedDay, DailyQuestSet, Achievement, Celebration, LeagueMember] as const) {
    await (model as typeof GemLedger).deleteMany({ userId });
  }
  await EngagementProfile.deleteOne({ _id: userId });
  await FriendStreak.updateMany({ pair: userId, status: { $ne: 'ended' } }, { $set: { status: 'ended' } });
  await HighFive.deleteMany({ $or: [{ fromId: userId }, { toId: userId }] });
  await AnalyticsEvent.deleteMany({ userId });
  await StoreEvent.updateMany({ userId }, { $set: { userId: null, 'redactedPayload.deleted_owner': sha256(userId) } });
  await User.updateOne(
    { _id: userId },
    {
      $set: { deletedAt: new Date(), displayName: 'Removed member', isGuest: true, roles: [] },
      $unset: { email: 1, passwordHash: 1, anonymousId: 1, pendingTimezone: 1 },
      $inc: { tokenVersion: 1 },
    },
  );
}

export async function processDeletions(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.DELETION_GRACE_DAYS * 86_400_000);
  const users = await User.find({ deletionRequestedAt: { $lte: cutoff }, deletedAt: null }).select({ _id: 1 }).limit(50).lean();
  for (const u of users) await deleteUserData(u._id);
  return users.length;
}
