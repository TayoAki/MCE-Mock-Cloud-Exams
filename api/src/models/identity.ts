import { Schema, model, type InferSchemaType } from 'mongoose';
import { opts, uuidId } from './common.js';

export const ROLES = ['learner', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const pendingTimezoneSchema = new Schema(
  { zone: { type: String, required: true }, effectiveAt: { type: Date, required: true } },
  { _id: false },
);

const userSchema = new Schema(
  {
    _id: uuidId,
    /** One external auth subject per profile: `guest:<uuid>` or `local:<uuid>`. */
    externalSubject: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true },
    passwordHash: { type: String },
    isGuest: { type: Boolean, required: true, default: true },
    roles: { type: [String], enum: ROLES, default: ['learner'] },
    displayName: { type: String, required: true, minlength: 1, maxlength: 60 },
    timezone: { type: String, required: true, default: 'Etc/UTC' },
    pendingTimezone: { type: pendingTimezoneSchema, default: null },
    timezoneChangedAt: { type: Date },
    dailyGoalMinutes: { type: Number, required: true, default: 5, min: 5, max: 60 },
    /** Incremented to revoke every issued token. */
    tokenVersion: { type: Number, required: true, default: 0 },
    anonymousId: { type: String },
    createdAt: { type: Date, required: true, default: Date.now },
    deletionRequestedAt: { type: Date },
    deletedAt: { type: Date },
  },
  opts,
);
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ roles: 1 });

export const User = model('User', userSchema);

export type UserRecord = InferSchemaType<typeof userSchema> & { _id: string };
