import { Schema, model } from 'mongoose';
import { DATE_RE, opts, uuidId } from './common.js';

/** Staging store with a property allowlist enforced by lib/analytics.ts. */
const analyticsEventSchema = new Schema(
  {
    _id: uuidId, // server event id, used for ingestion deduplication
    userId: { type: String, default: null },
    anonymousId: { type: String, default: null },
    eventName: { type: String, required: true },
    occurredAt: { type: Date, required: true, default: Date.now },
    sourceVersion: { type: String, required: true },
    examVersionId: { type: String, default: null },
    sessionId: { type: String, default: null },
    properties: { type: Schema.Types.Mixed, default: {} },
  },
  { ...opts, minimize: false },
);
analyticsEventSchema.index({ eventName: 1, occurredAt: -1 });
analyticsEventSchema.index({ userId: 1, occurredAt: -1 });
export const AnalyticsEvent = model('AnalyticsEvent', analyticsEventSchema);

const contentAuditSchema = new Schema(
  {
    _id: uuidId,
    actorId: { type: String, required: true },
    entityType: {
      type: String,
      required: true,
      enum: ['question_version', 'exam_version', 'lesson', 'issue_report', 'entitlement', 'exam_outcome', 'user'],
    },
    entityId: { type: String, required: true },
    action: { type: String, required: true },
    note: { type: String, default: '' },
    details: { type: Schema.Types.Mixed, default: {} },
    recordedAt: { type: Date, required: true, default: Date.now },
  },
  { ...opts, collection: 'private_content_audit' },
);
contentAuditSchema.index({ entityType: 1, entityId: 1, recordedAt: -1 });
contentAuditSchema.index({ recordedAt: -1 });
export const ContentAudit = model('ContentAudit', contentAuditSchema);

/** Stored responses for idempotent mutations keyed by client_request_id. */
const idempotencySchema = new Schema(
  {
    userId: { type: String, required: true },
    scope: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: { type: Number, required: true },
    response: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 },
  },
  { ...opts, minimize: false },
);
idempotencySchema.index({ userId: 1, scope: 1, key: 1 }, { unique: true });
export const IdempotencyRecord = model('IdempotencyRecord', idempotencySchema);

/** Daily AI call counters; userId '*' is the global budget. */
const aiUsageSchema = new Schema(
  {
    userId: { type: String, required: true },
    date: { type: String, required: true, match: DATE_RE },
    count: { type: Number, required: true, default: 0 },
  },
  opts,
);
aiUsageSchema.index({ userId: 1, date: 1 }, { unique: true });
export const AiUsage = model('AiUsage', aiUsageSchema);
