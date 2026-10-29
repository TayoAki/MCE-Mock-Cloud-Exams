import { tx } from '../db.js';
import {
  CircleMember,
  DailyStudyDay,
  Enrollment,
  Entitlement,
  ExamOutcome,
  NotificationJob,
  NotificationPreference,
  StoreEvent,
  User,
  type UserRecord,
} from '../models/index.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { signToken } from '../auth/tokens.js';
import { config } from '../config.js';
import { track } from '../lib/analytics.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
import { PLUS_FEATURES, PREVIEW_DAYS } from '../lib/rules.js';
import { effectiveTimezone, isValidZone, localDate, nextLocalMidnight } from '../lib/time.js';
import { activeEntitlements, toEntitlement } from './access.js';
import { currentVersions } from './content.js';
import { habitSummary, xpTotal } from './progress.js';
import { syncStreak } from './streaks.js';

export function toProfile(user: UserRecord) {
  return {
    id: user._id,
    display_name: user.displayName,
    email: user.email ?? null,
    is_guest: user.isGuest,
    roles: user.roles,
    timezone: effectiveTimezone(user),
    pending_timezone:
      user.pendingTimezone && user.pendingTimezone.effectiveAt > new Date()
        ? { zone: user.pendingTimezone.zone, effective_at: user.pendingTimezone.effectiveAt.toISOString() }
        : null,
    daily_goal_minutes: user.dailyGoalMinutes,
    deletion_requested_at: user.deletionRequestedAt?.toISOString() ?? null,
  };
}

function authResponse(user: UserRecord) {
  return { token: signToken(user), user: toProfile(user) };
}

function checkZone(zone: string) {
  if (!isValidZone(zone)) throw badRequest('invalid_timezone', 'Use an IANA timezone such as America/New_York');
}

/** Guests can explore and practise; their progress is durable and upgrades in place. */
export async function createGuest(input: { display_name?: string; timezone: string; anonymous_id?: string }) {
  checkZone(input.timezone);
  const id = uuid();
  const user = await User.create({
    _id: id,
    externalSubject: `guest:${id}`,
    isGuest: true,
    displayName: input.display_name?.trim() || 'Learner',
    timezone: input.timezone,
    anonymousId: input.anonymous_id ?? null,
  });
  return authResponse(user.toObject());
}

/**
 * Registering while signed in as a guest attaches credentials to the same
 * identity, so every attempt, credit and reward stays with the learner.
 */
export async function register(
  current: UserRecord | undefined,
  input: { email: string; password: string; display_name?: string; timezone?: string },
) {
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email })) throw conflict('email_taken', 'An account with this email already exists. Sign in instead.');
  const passwordHash = await hashPassword(input.password);

  if (current?.isGuest) {
    const updated = await User.findOneAndUpdate(
      { _id: current._id, isGuest: true },
      {
        $set: {
          email,
          passwordHash,
          isGuest: false,
          externalSubject: `local:${current._id}`,
          ...(input.display_name ? { displayName: input.display_name.trim() } : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean<UserRecord>();
    if (!updated) throw conflict('upgrade_failed', 'This guest profile was already upgraded');
    track('account_upgraded', { userId: updated._id });
    return { ...authResponse(updated), upgraded_guest: true };
  }

  if (input.timezone) checkZone(input.timezone);
  const id = uuid();
  const user = await User.create({
    _id: id,
    externalSubject: `local:${id}`,
    email,
    passwordHash,
    isGuest: false,
    displayName: input.display_name?.trim() || email.split('@')[0]!.slice(0, 60),
    timezone: input.timezone ?? 'Etc/UTC',
  });
  return { ...authResponse(user.toObject()), upgraded_guest: false };
}

export async function login(input: { email: string; password: string }) {
  const user = await User.findOne({ email: input.email.trim().toLowerCase() }).lean<UserRecord>();
  // Same response whether the email or the password is wrong.
  if (!user || user.deletedAt || !(await verifyPassword(input.password, user.passwordHash))) {
    throw unauthorized('Email or password is incorrect');
  }
  return authResponse(user);
}

export async function logoutEverywhere(userId: string) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

export async function profileSummary(user: UserRecord) {
  const timezone = effectiveTimezone(user);
  // Applies freezes or the weekend amulet to any days missed since the last visit.
  await tx(() => syncStreak(user._id, localDate(new Date(), timezone)));
  const [habits, xp, entitlements, previewUsed, prefs, enrollments] = await Promise.all([
    habitSummary(user._id, timezone),
    xpTotal(user._id),
    activeEntitlements(user._id),
    Entitlement.exists({ userId: user._id, source: 'preview' }),
    NotificationPreference.findById(user._id).lean(),
    enrollmentList(user._id),
  ]);
  return {
    user: toProfile(user),
    streak: habits,
    xp_total: xp,
    entitlements: entitlements.map(toEntitlement),
    plus_enabled: config.PLUS_ENABLED,
    plus_active: entitlements.length > 0,
    plus_ends_at: entitlements[0]?.endsAt.toISOString() ?? null,
    preview_used: !!previewUsed,
    preferences: toPreferences(prefs),
    enrollments,
  };
}

export async function enrollmentList(userId: string) {
  const rows = await Enrollment.find({ userId }).sort({ startedAt: 1 }).lean();
  const versions = await currentVersions([...new Set(rows.map((r) => r.examId))]);
  return rows.map((e) => ({
    id: e._id,
    exam_id: e.examId,
    exam_version_id: e.examVersionId,
    status: e.status,
    exam_date: e.examDate ?? null,
    newer_version_id: versions.get(e.examId) && versions.get(e.examId)!._id !== e.examVersionId ? versions.get(e.examId)!._id : null,
  }));
}

function toPreferences(
  p: {
    remindersEnabled: boolean;
    dailyLocalTime?: string | null;
    quietStart?: string | null;
    quietEnd?: string | null;
    weeklyCircleSummary?: boolean | null;
    smartTiming?: boolean | null;
    streakSaver?: boolean | null;
  } | null,
) {
  return {
    reminders_enabled: p?.remindersEnabled ?? false,
    daily_local_time: p?.dailyLocalTime ?? '21:00',
    quiet_start: p?.quietStart ?? '23:00',
    quiet_end: p?.quietEnd ?? '08:00',
    weekly_circle_summary: p?.weeklyCircleSummary ?? false,
    smart_timing: p?.smartTiming ?? true,
    streak_saver: p?.streakSaver ?? true,
  };
}

export interface PreferencesInput {
  timezone?: string;
  daily_goal_minutes?: 5 | 10 | 15;
  reminders_enabled?: boolean;
  daily_local_time?: string;
  quiet_start?: string;
  quiet_end?: string;
  weekly_circle_summary?: boolean;
  smart_timing?: boolean;
  streak_saver?: boolean;
  display_name?: string;
}

/**
 * Timezone changes apply from the next local midnight and never move existing
 * study credits. Learners without credits yet switch immediately.
 */
export async function updatePreferences(user: UserRecord, input: PreferencesInput) {
  const now = new Date();
  const userSet: Record<string, unknown> = {};
  if (input.daily_goal_minutes !== undefined) userSet.dailyGoalMinutes = input.daily_goal_minutes;
  if (input.display_name !== undefined) userSet.displayName = input.display_name.trim();

  if (input.timezone !== undefined) {
    checkZone(input.timezone);
    const current = effectiveTimezone(user, now);
    if (input.timezone !== current) {
      const hasCredits = await DailyStudyDay.exists({ userId: user._id });
      if (!hasCredits) {
        userSet.timezone = input.timezone;
        userSet.pendingTimezone = null;
      } else {
        if (user.timezoneChangedAt && now.getTime() - user.timezoneChangedAt.getTime() < 24 * 3600_000) {
          throw new HttpError(429, 'timezone_change_limited', 'You can change your timezone once per day');
        }
        userSet.timezone = current;
        userSet.pendingTimezone = { zone: input.timezone, effectiveAt: nextLocalMidnight(now, current) };
      }
      userSet.timezoneChangedAt = now;
    }
  }
  if (Object.keys(userSet).length) await User.updateOne({ _id: user._id }, { $set: userSet }, { runValidators: true });

  const prefSet: Record<string, unknown> = { updatedAt: now };
  if (input.reminders_enabled !== undefined) prefSet.remindersEnabled = input.reminders_enabled;
  if (input.daily_local_time !== undefined) prefSet.dailyLocalTime = input.daily_local_time;
  if (input.quiet_start !== undefined) prefSet.quietStart = input.quiet_start;
  if (input.quiet_end !== undefined) prefSet.quietEnd = input.quiet_end;
  if (input.weekly_circle_summary !== undefined) prefSet.weeklyCircleSummary = input.weekly_circle_summary;
  if (input.smart_timing !== undefined) prefSet.smartTiming = input.smart_timing;
  if (input.streak_saver !== undefined) prefSet.streakSaver = input.streak_saver;
  await NotificationPreference.updateOne({ _id: user._id }, { $set: prefSet }, { upsert: true, runValidators: true });
  if (input.reminders_enabled === false) {
    await NotificationJob.updateMany({ userId: user._id, status: 'queued' }, { $set: { status: 'cancelled', reason: 'opted_out' } });
  }

  const fresh = await User.findById(user._id).lean<UserRecord>();
  const prefs = await NotificationPreference.findById(user._id).lean();
  return { user: toProfile(fresh!), preferences: toPreferences(prefs) };
}

/** One explicit, no-card, nonrenewing 14-day preview per account. */
export async function startPreview(user: UserRecord) {
  if (!config.PLUS_ENABLED) throw conflict('plus_unavailable', 'CertPath is free right now, so there is nothing to preview');
  if (user.isGuest) throw forbidden('account_required', 'Save your progress with an account before starting the preview');
  if (await Entitlement.exists({ userId: user._id, source: 'preview' })) {
    throw conflict('preview_already_used', 'The free preview can be used once per account');
  }
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + PREVIEW_DAYS * 86_400_000);
  const sourceRef = `preview:${user._id}`;
  for (const featureKey of PLUS_FEATURES) {
    // The unique (user, feature, source, source_ref) index makes repeats harmless.
    await Entitlement.updateOne(
      { userId: user._id, featureKey, source: 'preview', sourceRef },
      { $setOnInsert: { _id: uuid(), startsAt, endsAt, revokedAt: null, createdAt: startsAt } },
      { upsert: true },
    );
  }
  track('entitlement_changed', { userId: user._id, properties: { source: 'preview', change: 'started' } });
  const rows = await activeEntitlements(user._id);
  return { entitlements: rows.map(toEntitlement), ends_at: endsAt.toISOString(), renews: false, card_required: false };
}

const PRODUCTS: Record<string, { months: number }> = {
  'certpath.plus.monthly': { months: 1 },
  'certpath.plus.annual': { months: 12 },
};

interface VerifiedPurchase {
  provider: 'apple' | 'google' | 'sandbox';
  eventId: string;
  originalTransactionId: string;
  productId: string;
  purchasedAt: Date;
  expiresAt: Date;
}

/**
 * Store verification boundary. Real App Store / Play verification needs provider
 * credentials and is not implemented; the sandbox verifier exists for development.
 */
function verifyStoreToken(provider: 'apple' | 'google', token: string): VerifiedPurchase {
  if (config.STORE_SANDBOX && token.startsWith('sandbox:')) {
    const [, productId, transactionId] = token.split(':');
    const product = productId ? PRODUCTS[productId] : undefined;
    if (!product || !transactionId) throw badRequest('invalid_receipt', 'The purchase token could not be verified');
    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt);
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + product.months);
    return { provider: 'sandbox', eventId: transactionId, originalTransactionId: transactionId, productId: productId!, purchasedAt, expiresAt };
  }
  throw new HttpError(501, 'store_verification_unavailable', `${provider} purchase verification is not configured on this server`);
}

/** Grants only from verified events; duplicate events never extend access twice. */
export async function verifyPurchase(user: UserRecord, input: { provider: 'apple' | 'google'; signed_transaction: string }) {
  if (!config.PLUS_ENABLED) throw conflict('plus_unavailable', 'CertPath is free right now, so there is nothing to buy');
  if (user.isGuest) throw forbidden('account_required', 'Create an account before purchasing');
  const purchase = verifyStoreToken(input.provider, input.signed_transaction);

  const owner = await StoreEvent.findOne({ provider: purchase.provider, originalTransactionId: purchase.originalTransactionId }).lean();
  if (owner?.userId && owner.userId !== user._id) {
    throw conflict('receipt_owned_elsewhere', 'This purchase belongs to a different CertPath account');
  }

  const restored = await tx(async () => {
    const existing = await StoreEvent.findOne({ provider: purchase.provider, providerEventId: purchase.eventId });
    if (!existing) {
      await StoreEvent.create([
        {
          provider: purchase.provider,
          providerEventId: purchase.eventId,
          originalTransactionId: purchase.originalTransactionId,
          productId: purchase.productId,
          userId: user._id,
          eventType: 'purchase',
          verifiedAt: new Date(),
          expiresAt: purchase.expiresAt,
          redactedPayload: { product_id: purchase.productId },
        },
      ]);
    }
    const endsAt = existing?.expiresAt ?? purchase.expiresAt;
    for (const featureKey of PLUS_FEATURES) {
      await Entitlement.updateOne(
        { userId: user._id, featureKey, source: 'store', sourceRef: purchase.originalTransactionId },
        { $setOnInsert: { _id: uuid(), startsAt: purchase.purchasedAt, createdAt: new Date() }, $max: { endsAt } },
        { upsert: true },
      );
    }
    return !!existing;
  });

  track('entitlement_changed', { userId: user._id, properties: { source: 'store', change: restored ? 'restored' : 'purchased' } });
  const rows = await activeEntitlements(user._id);
  return { restored, entitlements: rows.map(toEntitlement) };
}

/** Passed/failed are dated, self-reported outcomes. Postponing is an exam-date edit instead. */
export async function recordOutcome(
  user: UserRecord,
  input: { enrollment_id: string; result: 'passed' | 'failed'; taken_at: string; pause_reminders: boolean; client_request_id: string },
) {
  const enrollment = await Enrollment.findOne({ _id: input.enrollment_id, userId: user._id }).lean();
  if (!enrollment) throw notFound('Enrollment');
  const takenAt = new Date(input.taken_at);
  if (takenAt.getTime() > Date.now() + 86_400_000) throw badRequest('invalid_date', 'The exam date cannot be in the future');

  const existing = await ExamOutcome.findOne({ userId: user._id, clientRequestId: input.client_request_id }).lean();
  const outcome =
    existing ??
    (await ExamOutcome.create({
      enrollmentId: enrollment._id,
      userId: user._id,
      examVersionId: enrollment.examVersionId,
      result: input.result,
      takenAt,
      clientRequestId: input.client_request_id,
    }));

  if (!existing) {
    const status = input.result === 'passed' ? 'passed' : input.pause_reminders ? 'paused' : enrollment.status;
    await Enrollment.updateOne({ _id: enrollment._id }, { $set: { status, ...(status === 'passed' ? { endedAt: new Date() } : {}) } });
    if (input.pause_reminders || input.result === 'passed') {
      await NotificationJob.updateMany({ userId: user._id, status: 'queued' }, { $set: { status: 'cancelled', reason: 'outcome_recorded' } });
    }
    track('exam_outcome_recorded', { userId: user._id, examVersionId: enrollment.examVersionId, properties: { result: input.result } });
  }
  return { id: outcome._id, result: outcome.result, verification_status: outcome.verificationStatus };
}

/** Stops reminders immediately and signs out everywhere; the worker deletes data after the grace period. */
export async function requestDeletion(user: UserRecord) {
  const now = new Date();
  await User.updateOne({ _id: user._id }, { $set: { deletionRequestedAt: user.deletionRequestedAt ?? now }, $inc: { tokenVersion: 1 } });
  await NotificationPreference.updateOne({ _id: user._id }, { $set: { remindersEnabled: false, updatedAt: now } }, { upsert: true });
  await NotificationJob.updateMany({ userId: user._id, status: 'queued' }, { $set: { status: 'cancelled', reason: 'deletion_requested' } });
  await CircleMember.updateMany({ userId: user._id, status: 'active' }, { $set: { status: 'left', leftAt: now } });
  const scheduledFor = new Date((user.deletionRequestedAt ?? now).getTime() + config.DELETION_GRACE_DAYS * 86_400_000);
  return { status: 'queued', scheduled_for: scheduledFor.toISOString() };
}
