import { Schema, model } from 'mongoose';
import { opts, uuidId } from './common.js';

const circleSchema = new Schema(
  {
    _id: uuidId,
    ownerId: { type: String, required: true },
    name: { type: String, required: true, minlength: 1, maxlength: 60 },
    timezone: { type: String, required: true, default: 'Etc/UTC' },
    weeklyTargetDays: { type: Number, required: true, min: 1, max: 7, default: 5 },
    status: { type: String, required: true, enum: ['active', 'archived'], default: 'active' },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
export const StudyCircle = model('StudyCircle', circleSchema);

const memberSchema = new Schema(
  {
    circleId: { type: String, required: true },
    userId: { type: String, required: true },
    role: { type: String, required: true, enum: ['owner', 'member'], default: 'member' },
    status: { type: String, required: true, enum: ['active', 'left', 'removed'], default: 'active' },
    joinedAt: { type: Date, required: true, default: Date.now },
    leftAt: { type: Date, default: null },
  },
  opts,
);
memberSchema.index({ circleId: 1, userId: 1 }, { unique: true });
memberSchema.index({ userId: 1, status: 1 });
export const CircleMember = model('CircleMember', memberSchema);

const inviteSchema = new Schema(
  {
    _id: uuidId,
    circleId: { type: String, required: true },
    inviterId: { type: String, required: true },
    /** Only the SHA-256 of the invite token is stored. */
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    useCount: { type: Number, required: true, default: 0, min: 0 },
    maxUses: { type: Number, required: true, default: 10, min: 1, max: 30 },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
export const CircleInvite = model('CircleInvite', inviteSchema);

/** The week's timezone and target are snapshotted when the week opens. */
const circleWeekSchema = new Schema(
  {
    _id: uuidId,
    circleId: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    timezoneSnapshot: { type: String, required: true },
    targetDays: { type: Number, required: true, min: 1, max: 7 },
  },
  opts,
);
circleWeekSchema.index({ circleId: 1, startsAt: 1 }, { unique: true });
export const CircleWeek = model('CircleWeek', circleWeekSchema);
