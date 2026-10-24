import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError, forbidden, unauthorized } from '../lib/errors.js';
import type { Role, UserRecord } from '../models/index.js';
import { passport } from './passport.js';

function authenticate(required: boolean): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('jwt', { session: false }, (err: unknown, user: UserRecord | false) => {
      if (err) return next(err);
      if (!user) {
        if (required) return next(unauthorized());
        return next();
      }
      req.user = user;
      next();
    })(req, res, next);
  };
}

/** Identity always comes from the verified token subject, never from the request body. */
export const requireAuth = authenticate(true);
export const optionalAuth = authenticate(false);

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (!roles.some((r) => user.roles.includes(r))) {
      return next(forbidden('insufficient_role', 'This action requires a staff role'));
    }
    next();
  };
}

export function currentUser(req: Request): UserRecord {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Authentication required');
  return req.user;
}
