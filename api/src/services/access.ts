import { config } from '../config.js';
import { Entitlement } from '../models/index.js';
import { PLUS_FEATURES, type FeatureKey } from '../lib/rules.js';

/** Valid when starts_at <= now < ends_at and not revoked. */
export async function activeEntitlements(userId: string, now = new Date()) {
  return Entitlement.find({ userId, revokedAt: null, startsAt: { $lte: now }, endsAt: { $gt: now } })
    .sort({ endsAt: -1 })
    .lean();
}

export async function featureSet(userId: string, now = new Date()): Promise<Set<FeatureKey>> {
  // With Plus off, CertPath is free: every learner has every feature.
  if (!config.PLUS_ENABLED) return new Set(PLUS_FEATURES);
  const rows = await activeEntitlements(userId, now);
  return new Set(rows.map((r) => r.featureKey as FeatureKey));
}

export function toEntitlement(e: { featureKey: string; source: string; startsAt: Date; endsAt: Date }) {
  return {
    feature_key: e.featureKey,
    source: e.source,
    starts_at: e.startsAt.toISOString(),
    ends_at: e.endsAt.toISOString(),
  };
}
