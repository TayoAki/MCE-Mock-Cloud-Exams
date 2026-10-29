import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

/** Per-user (or per-IP before sign-in) limits for attempt, AI, auth and invite endpoints. */
export function limiter(name: string, limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.NODE_ENV === 'test',
    keyGenerator: (req: Request) => `${name}:${req.user?._id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
    handler: (req, res) => {
      res.status(429).json({ code: 'rate_limited', message: 'Too many requests. Try again shortly.', request_id: req.requestId });
    },
  });
}

export const authLimiter = limiter('auth', 30, 15 * 60_000);
export const answerLimiter = limiter('answer', 120, 60_000);
export const aiLimiter = limiter('ai', 10, 60_000);
export const inviteLimiter = limiter('invite', 20, 60 * 60_000);
export const writeLimiter = limiter('write', 60, 60_000);
