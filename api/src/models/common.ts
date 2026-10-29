import { randomUUID } from 'node:crypto';

/** UUID string primary keys keep IDs identical to the API contract's uuid format. */
export const uuidId = { type: String, default: () => randomUUID() } as const;

export const opts = { versionKey: false, id: false } as const;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
