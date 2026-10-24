import { Schema, model } from 'mongoose';
import { PLUS_FEATURES } from '../lib/rules.js';
import { opts, uuidId } from './common.js';

const entitlementSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    featureKey: { type: String, required: true, enum: PLUS_FEATURES },
    source: { type: String, required: true, enum: ['preview', 'store', 'manual'] },
    sourceRef: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
entitlementSchema.index({ userId: 1, featureKey: 1, source: 1, sourceRef: 1 }, { unique: true });
entitlementSchema.index({ userId: 1, endsAt: 1 });
entitlementSchema.pre('validate', function () {
  if (this.endsAt <= this.startsAt) throw new Error('Entitlement must end after it starts');
});
export const Entitlement = model('Entitlement', entitlementSchema);

/** Server-only. Payloads are redacted before storage; signed tokens are never logged. */
const storeEventSchema = new Schema(
  {
    _id: uuidId,
    provider: { type: String, required: true, enum: ['apple', 'google', 'sandbox', 'manual'] },
    providerEventId: { type: String, required: true },
    originalTransactionId: { type: String, required: true },
    productId: { type: String, required: true },
    userId: { type: String, default: null },
    eventType: { type: String, required: true },
    verifiedAt: { type: Date, required: true },
    expiresAt: { type: Date },
    redactedPayload: { type: Schema.Types.Mixed, default: {} },
  },
  { ...opts, collection: 'private_store_events' },
);
storeEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });
storeEventSchema.index({ provider: 1, originalTransactionId: 1 });
export const StoreEvent = model('StoreEvent', storeEventSchema);
