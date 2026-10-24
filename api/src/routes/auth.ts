import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth, currentUser } from '../auth/middleware.js';
import { parseBody } from '../lib/http.js';
import { authLimiter } from '../lib/rate-limit.js';
import { createGuest, login, logoutEverywhere, register } from '../services/account.js';

export const authRouter = Router();

authRouter.post('/auth/guest', authLimiter, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({ timezone: z.string().min(1).max(64), display_name: z.string().min(1).max(60).optional(), anonymous_id: z.uuid().optional() }),
  );
  res.status(201).json(await createGuest(body));
});

authRouter.post('/auth/register', authLimiter, optionalAuth, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      email: z.email().max(254),
      password: z.string().min(8).max(200),
      display_name: z.string().min(1).max(60).optional(),
      timezone: z.string().min(1).max(64).optional(),
    }),
  );
  res.status(201).json(await register(req.user, body));
});

authRouter.post('/auth/login', authLimiter, async (req, res) => {
  const body = parseBody(req, z.strictObject({ email: z.string().min(3).max(254), password: z.string().min(1).max(200) }));
  res.json(await login(body));
});

authRouter.post('/auth/logout-all', requireAuth, async (req, res) => {
  await logoutEverywhere(currentUser(req)._id);
  res.status(204).end();
});
