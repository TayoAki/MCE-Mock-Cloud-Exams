import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { idParam, parseBody } from '../lib/http.js';
import { inviteLimiter } from '../lib/rate-limit.js';
import { circleView, createCircle, createInvite, joinCircle, leaveCircle, myCircles } from '../services/circles.js';

/** Phase 2 accountability circles. */
export const circlesRouter = Router();

circlesRouter.get('/circles', requireAuth, async (req, res) => {
  res.json({ circles: await myCircles(currentUser(req)._id) });
});

circlesRouter.post('/circles', requireAuth, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({ name: z.string().min(1).max(60), timezone: z.string().min(1).max(64), weekly_target_days: z.int().min(1).max(7).default(5) }),
  );
  res.status(201).json(await createCircle(currentUser(req), body));
});

circlesRouter.get('/circles/:id', requireAuth, async (req, res) => {
  res.json(await circleView(currentUser(req)._id, idParam(req)));
});

circlesRouter.post('/circles/:id/invites', requireAuth, inviteLimiter, async (req, res) => {
  res.status(201).json(await createInvite(currentUser(req), idParam(req)));
});

circlesRouter.post('/circles/:id/leave', requireAuth, async (req, res) => {
  res.json(await leaveCircle(currentUser(req), idParam(req)));
});

circlesRouter.post('/circle-joins', requireAuth, inviteLimiter, async (req, res) => {
  const body = parseBody(req, z.strictObject({ token: z.string().min(16).max(200) }));
  res.json(await joinCircle(currentUser(req), body.token));
});
