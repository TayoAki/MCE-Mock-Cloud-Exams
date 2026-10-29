import { Schema, model } from 'mongoose';
import { DATE_RE, TIME_RE, opts, uuidId } from './common.js';

const studyDaySchema = new Schema(
  {
    userId: { type: String, required: true },
    studyDate: { type: String, required: true, match: DATE_RE },
    timezoneSnapshot: { type: String, required: true },
    qualifyingSessionId: { type: String, required: true, unique: true },
    earnedAt: { type: Date, required: true, default: Date.now },
  },
  opts,
);
studyDaySchema.index({ userId: 1, studyDate: 1 }, { unique: true });
export const DailyStudyDay = model('DailyStudyDay', studyDaySchema);

/** Derived aggregate; DailyStudyDay rows remain the rebuildable source of truth. */
const streakSchema = new Schema(
  {
    _id: { type: String, required: true }, // user id
    currentDays: { type: Number, required: true, default: 0, min: 0 },
    longestDays: { type: Number, required: true, default: 0, min: 0 },
    lastStudyDate: { type: String, match: DATE_RE, default: null },
    /** Latest date the streak is continuous through, including protected days. */
    lastCoveredDate: { type: String, match: DATE_RE, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  opts,
);
export const StreakState = model('StreakState', streakSchema);

export const REWARD_REASONS = [
  'new_attempt',
  'first_correct',
  'lesson_complete',
  'review_repeat',
  'perfect_lesson',
  'xp_boost',
  'manual_adjustment',
] as const;

const rewardSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    sessionId: { type: String, default: null },
    rewardType: { type: String, required: true, enum: ['xp'], default: 'xp' },
    amount: { type: Number, required: true, min: 1 },
    reasonCode: { type: String, required: true, enum: REWARD_REASONS },
    /** Polymorphic: the service verifies ownership and type before inserting. */
    sourceType: { type: String, required: true, enum: ['attempt', 'session', 'manual'] },
    sourceId: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  opts,
);
rewardSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
rewardSchema.index({ userId: 1, sourceType: 1, sourceId: 1, reasonCode: 1 }, { unique: true });
rewardSchema.index({ userId: 1, createdAt: -1 });
rewardSchema.index({ sessionId: 1 });
export const RewardLedger = model('RewardLedger', rewardSchema);

const notificationPreferenceSchema = new Schema(
  {
    _id: { type: String, required: true }, // user id
    remindersEnabled: { type: Boolean, required: true, default: false },
    dailyLocalTime: { type: String, match: TIME_RE, default: '21:00' },
    quietStart: { type: String, match: TIME_RE, default: '23:00' },
    quietEnd: { type: String, match: TIME_RE, default: '08:00' },
    weeklyCircleSummary: { type: Boolean, default: false },
    /** Send at the time this learner usually studies instead of `dailyLocalTime`. */
    smartTiming: { type: Boolean, default: true },
    /** A second, last-call reminder in the evening when a streak is about to end. */
    streakSaver: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now },
  },
  opts,
);
export const NotificationPreference = model('NotificationPreference', notificationPreferenceSchema);

const pushTokenSchema = new Schema(
  {
    userId: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  opts,
);
pushTokenSchema.index({ userId: 1 });
export const PushToken = model('PushToken', pushTokenSchema);

const notificationJobSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    kind: { type: String, required: true, enum: ['daily_goal', 'streak_at_risk', 'circle_summary', 'friend_nudge'] },
    studyDate: { type: String, required: true, match: DATE_RE },
    scheduledAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ['queued', 'cancelled', 'sent', 'failed'], default: 'queued' },
    dedupeKey: { type: String, required: true, unique: true },
    reason: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    /** The wording the bandit picked at send time, kept so a later study day can credit it. */
    templateKey: { type: String, default: null },
    title: { type: String, default: null },
    body: { type: String, default: null },
    /** Copy for a friend's nudge, fixed when it is queued. */
    payload: { type: Schema.Types.Mixed, default: null },
    sentAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
  },
  opts,
);
notificationJobSchema.index({ status: 1, scheduledAt: 1 });
notificationJobSchema.index({ userId: 1, studyDate: 1 });
notificationJobSchema.index({ userId: 1, sentAt: -1 });
export const NotificationJob = model('NotificationJob', notificationJobSchema);

/** Running results for one reminder template across all learners: the bandit's shared prior. */
const reminderArmSchema = new Schema(
  {
    _id: { type: String, required: true }, // template key
    sent: { type: Number, required: true, default: 0 },
    converted: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  opts,
);
export const ReminderArm = model('ReminderArm', reminderArmSchema);
