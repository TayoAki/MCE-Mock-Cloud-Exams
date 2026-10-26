import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { SESSION_MODES } from '../models/index.js';
import { idParam, parseBody, uuidParam } from '../lib/http.js';
import { answerLimiter, writeLimiter } from '../lib/rate-limit.js';
import { finalizeSession } from '../services/completion.js';
import { submitAnswer } from '../services/grading.js';
import {
  abandonSession,
  getOwnedSession,
  listActiveSessions,
  sessionFeedback,
  sessionResults,
  sessionView,
  startSession,
} from '../services/sessions.js';

export const sessionsRouter = Router();
sessionsRouter.use('/sessions', requireAuth);

sessionsRouter.post('/sessions', writeLimiter, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      enrollment_id: uuidParam,
      client_session_id: uuidParam,
      mode: z.enum(SESSION_MODES),
      lesson_id: uuidParam.optional(),
      story_id: uuidParam.optional(),
      domain_ids: z.array(uuidParam).max(20).optional(),
      question_count: z.int().min(1).max(200).optional(),
    }),
  );
  res.status(201).json(await startSession(currentUser(req), body));
});

sessionsRouter.get('/sessions', async (req, res) => {
  res.json({ sessions: await listActiveSessions(currentUser(req)._id) });
});

sessionsRouter.get('/sessions/:id', async (req, res) => {
  const session = await getOwnedSession(currentUser(req)._id, idParam(req));
  res.json(await sessionView(session));
});

sessionsRouter.post('/sessions/:id/answers', answerLimiter, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      session_item_id: uuidParam,
      client_submission_id: uuidParam,
      // Choice keys ("A"), or "A=2" pairs for match questions; empty for typed answers.
      selected_options: z.array(z.string().regex(/^[A-Z](=[1-9])?$/)).max(26),
      typed_answer: z.string().max(200).optional(),
      input_mode: z.enum(['tap', 'keyboard', 'voice']).optional(),
      confidence: z.enum(['unsure', 'somewhat', 'confident']).optional(),
      reasoning_text: z.string().max(2000).optional(),
    }),
  );
  if (new Set(body.selected_options).size !== body.selected_options.length) {
    res.status(400).json({ code: 'validation_failed', message: 'selected_options must be unique', request_id: req.requestId });
    return;
  }
  res.json(await submitAnswer(currentUser(req)._id, idParam(req), body));
});

sessionsRouter.post('/sessions/:id/complete', async (req, res) => {
  parseBody(req, z.strictObject({}));
  res.json(await finalizeSession(idParam(req), { userId: currentUser(req)._id, reason: 'submit' }));
});

sessionsRouter.post('/sessions/:id/abandon', async (req, res) => {
  res.json(await abandonSession(currentUser(req)._id, idParam(req)));
});

sessionsRouter.get('/sessions/:id/results', async (req, res) => {
  res.json(await sessionResults(currentUser(req)._id, idParam(req)));
});

sessionsRouter.get('/sessions/:id/feedback', async (req, res) => {
  res.json(await sessionFeedback(currentUser(req)._id, idParam(req)));
});
