import { Schema, model } from 'mongoose';
import { LEAGUE_TIERS } from '../lib/rules.js';
import { DATE_RE, opts, uuidId } from './common.js';

/**
 * Per-learner engagement state. Gems mirror the GemLedger sum (both change in
 * the same transaction); everything else is small, current state.
 */
const engagementSchema = new Schema(
  {
    _id: { type: String, required: true }, // user id
    gems: { type: Number, required: true, default: 0, min: 0 },
    freezes: { type: Number, required: true, default: 0, min: 0 },
    /** The weekend (Saturday's date) an amulet protects. */
    amuletSaturday: { type: String, match: DATE_RE, default: null },
    wager: {
      type: new Schema(
        {
          startedOn: { type: String, required: true, match: DATE_RE },
          stake: { type: Number, required: true },
          status: { type: String, required: true, enum: ['active', 'won', 'lost'] },
          resolvedOn: { type: String, match: DATE_RE, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    /** Double XP until this instant. */
    boostUntil: { type: Date, default: null },
    /** A recently broken streak that can still be repaired. */
    brokenStreak: {
      type: new Schema(
        {
          days: { type: Number, required: true },
          lastCoveredDate: { type: String, required: true, match: DATE_RE },
          firstMissedDate: { type: String, required: true, match: DATE_RE },
        },
        { _id: false },
      ),
      default: null,
    },
    leagueTier: { type: String, enum: LEAGUE_TIERS, default: 'bronze' },
    leagueHidden: { type: Boolean, default: false },
    level: { type: Number, default: 1 },
    updatedAt: { type: Date, default: Date.now },
  },
  { ...opts, minimize: false },
);
export const EngagementProfile = model('EngagementProfile', engagementSchema);

const gemLedgerSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    /** Positive when earned, negative when spent. */
    amount: { type: Number, required: true },
    reason: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  opts,
);
gemLedgerSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
gemLedgerSchema.index({ userId: 1, createdAt: -1 });
export const GemLedger = model('GemLedger', gemLedgerSchema);

/** The plan's streak_freeze_ledger: a protected date keeps a streak alive but is never a study day. */
const protectedDaySchema = new Schema(
  {
    userId: { type: String, required: true },
    date: { type: String, required: true, match: DATE_RE },
    source: { type: String, required: true, enum: ['freeze', 'amulet', 'repair'] },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  opts,
);
protectedDaySchema.index({ userId: 1, date: 1 }, { unique: true });
export const ProtectedDay = model('ProtectedDay', protectedDaySchema);

const questSchema = new Schema(
  {
    key: { type: String, required: true },
    metric: { type: String, required: true },
    label: { type: String, required: true },
    target: { type: Number, required: true, min: 1 },
    completedAt: { type: Date, default: null },
  },
  { _id: false },
);

/** Three quests per learner-local date; completing all three unlocks one chest. */
const dailyQuestSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    date: { type: String, required: true, match: DATE_RE },
    timezone: { type: String, required: true },
    quests: { type: [questSchema], required: true },
    chestOpenedAt: { type: Date, default: null },
    chestReward: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { ...opts, minimize: false },
);
dailyQuestSchema.index({ userId: 1, date: 1 }, { unique: true });
export const DailyQuestSet = model('DailyQuestSet', dailyQuestSchema);

const achievementSchema = new Schema(
  {
    userId: { type: String, required: true },
    key: { type: String, required: true },
    earnedAt: { type: Date, required: true, default: Date.now },
  },
  opts,
);
achievementSchema.index({ userId: 1, key: 1 }, { unique: true });
export const Achievement = model('Achievement', achievementSchema);

export const CELEBRATION_KINDS = [
  'level_up',
  'achievement',
  'streak_milestone',
  'quest_complete',
  'quests_done',
  'monthly_challenge',
  'freeze_used',
  'amulet_used',
  'streak_broken',
  'streak_repaired',
  'wager_won',
  'wager_lost',
  'league_result',
  'friend_streak',
  'high_five',
  'nudge',
  'circle_quest',
] as const;

/** Moments the app plays once, in order. The server decides them; the app only shows them. */
const celebrationSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    kind: { type: String, required: true, enum: CELEBRATION_KINDS },
    payload: { type: Schema.Types.Mixed, default: {} },
    /** Makes enqueueing idempotent. */
    dedupeKey: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
    seenAt: { type: Date, default: null },
  },
  { ...opts, minimize: false },
);
celebrationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
celebrationSchema.index({ userId: 1, seenAt: 1, createdAt: 1 });
export const Celebration = model('Celebration', celebrationSchema);

/** A weekly group of up to 30 learners in one tier. Weeks run Monday to Monday, UTC. */
const leagueCohortSchema = new Schema(
  {
    _id: uuidId,
    weekStart: { type: String, required: true, match: DATE_RE },
    tier: { type: String, required: true, enum: LEAGUE_TIERS },
    size: { type: Number, required: true, default: 0 },
    closedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
leagueCohortSchema.index({ weekStart: 1, tier: 1, size: 1 });
leagueCohortSchema.index({ closedAt: 1, weekStart: 1 });
export const LeagueCohort = model('LeagueCohort', leagueCohortSchema);

const leagueMemberSchema = new Schema(
  {
    userId: { type: String, required: true },
    weekStart: { type: String, required: true, match: DATE_RE },
    cohortId: { type: String, required: true },
    tier: { type: String, required: true, enum: LEAGUE_TIERS },
    /** XP earned this league week (UTC). */
    xp: { type: Number, required: true, default: 0 },
    hidden: { type: Boolean, default: false },
    finalRank: { type: Number, default: null },
    outcome: { type: String, enum: ['promoted', 'demoted', 'stayed', null], default: null },
    joinedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  opts,
);
leagueMemberSchema.index({ userId: 1, weekStart: 1 }, { unique: true });
leagueMemberSchema.index({ cohortId: 1, xp: -1 });
export const LeagueMember = model('LeagueMember', leagueMemberSchema);

/** A streak two friends keep together: a day counts when both studied on that date. */
const friendStreakSchema = new Schema(
  {
    _id: uuidId,
    /** The two user ids, sorted. */
    pair: { type: [String], required: true },
    pairKey: { type: String, required: true, unique: true },
    inviterId: { type: String, required: true },
    status: { type: String, required: true, enum: ['pending', 'active', 'ended'], default: 'pending' },
    currentDays: { type: Number, default: 0 },
    longestDays: { type: Number, default: 0 },
    lastDate: { type: String, match: DATE_RE, default: null },
    createdAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null },
  },
  opts,
);
friendStreakSchema.index({ pair: 1, status: 1 });
export const FriendStreak = model('FriendStreak', friendStreakSchema);

/** One high-five (or nudge) per sender, recipient and day. */
const highFiveSchema = new Schema(
  {
    _id: uuidId,
    fromId: { type: String, required: true },
    toId: { type: String, required: true },
    kind: { type: String, required: true, enum: ['high_five', 'nudge'] },
    date: { type: String, required: true, match: DATE_RE },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
highFiveSchema.index({ fromId: 1, toId: 1, kind: 1, date: 1 }, { unique: true });
highFiveSchema.index({ toId: 1, createdAt: -1 });
export const HighFive = model('HighFive', highFiveSchema);
