import { IdempotencyRecord } from '../models/index.js';
import { conflict, isDuplicateKey } from './errors.js';
import { sha256, stableStringify } from './ids.js';

export interface StoredResponse<T> {
  status: number;
  body: T;
}

/**
 * Same key and same body returns the saved response. Same key with a different
 * body is a 409. Handlers must also be safe to repeat (unique indexes), because
 * two concurrent first requests can both reach the handler.
 */
export async function idempotent<T>(
  userId: string,
  scope: string,
  key: string,
  body: unknown,
  handler: () => Promise<StoredResponse<T>>,
): Promise<StoredResponse<T>> {
  const requestHash = sha256(stableStringify(body));
  const existing = await IdempotencyRecord.findOne({ userId, scope, key }).lean();
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw conflict('idempotency_conflict', 'This request ID was already used with a different body');
    }
    return { status: existing.status, body: existing.response as T };
  }
  const result = await handler();
  try {
    await IdempotencyRecord.create({ userId, scope, key, requestHash, status: result.status, response: result.body });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  return result;
}
