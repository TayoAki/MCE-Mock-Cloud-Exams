import { Celebration, EngagementProfile, GemLedger, type CELEBRATION_KINDS } from '../models/index.js';
import { conflict } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';

export type CelebrationKind = (typeof CELEBRATION_KINDS)[number];

/** The learner's engagement state, created on first use. */
export async function ensureProfile(userId: string) {
  return (await EngagementProfile.findOneAndUpdate(
    { _id: userId },
    { $setOnInsert: { gems: 0, freezes: 0, leagueTier: 'bronze', level: 1 } },
    { upsert: true, returnDocument: 'after' },
  ))!;
}

/** Adds gems once per idempotency key. Returns the gems actually added. */
export async function earnGems(userId: string, amount: number, reason: string, idempotencyKey: string): Promise<number> {
  if (amount <= 0) return 0;
  const res = await GemLedger.updateOne(
    { userId, idempotencyKey },
    { $setOnInsert: { _id: uuid(), amount, reason, createdAt: new Date() } },
    { upsert: true },
  );
  if (!res.upsertedCount) return 0;
  await EngagementProfile.updateOne({ _id: userId }, { $inc: { gems: amount }, $set: { updatedAt: new Date() } }, { upsert: true });
  return amount;
}

/**
 * Spends gems inside a transaction. Throws 409 not_enough_gems when the
 * balance is short; a repeated key is a no-op that returns false.
 */
export async function spendGems(userId: string, cost: number, reason: string, idempotencyKey: string): Promise<boolean> {
  if (await GemLedger.exists({ userId, idempotencyKey })) return false;
  const res = await EngagementProfile.updateOne({ _id: userId, gems: { $gte: cost } }, { $inc: { gems: -cost }, $set: { updatedAt: new Date() } });
  if (!res.modifiedCount) throw conflict('not_enough_gems', 'You need more gems for that', { cost });
  await GemLedger.create([{ userId, amount: -cost, reason, idempotencyKey }]);
  return true;
}

/** Queues a moment for the app to play once. Idempotent per dedupe key; returns the id when newly queued. */
export async function celebrate(userId: string, kind: CelebrationKind, payload: Record<string, unknown>, dedupeKey: string): Promise<string | null> {
  const id = uuid();
  const res = await Celebration.updateOne(
    { userId, dedupeKey },
    { $setOnInsert: { _id: id, kind, payload, createdAt: new Date(), seenAt: null } },
    { upsert: true },
  );
  return res.upsertedCount ? id : null;
}

export function toCelebration(c: { _id: string; kind: string; payload?: unknown; createdAt: Date }) {
  return { id: c._id, kind: c.kind, payload: c.payload ?? {}, created_at: c.createdAt.toISOString() };
}

export async function unseenCelebrations(userId: string) {
  const rows = await Celebration.find({ userId, seenAt: null }).sort({ createdAt: 1 }).limit(30).lean();
  return rows.map(toCelebration);
}

export async function markCelebrationsSeen(userId: string, ids: string[]) {
  await Celebration.updateMany({ userId, _id: { $in: ids }, seenAt: null }, { $set: { seenAt: new Date() } });
}
