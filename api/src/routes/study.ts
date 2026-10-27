import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { idParam, parseBody, uuidParam } from '../lib/http.js';
import { aiLimiter, writeLimiter } from '../lib/rate-limit.js';
import { flagQuestion, listFlags, unflagQuestion } from '../services/flags.js';
import { levelUpOverview } from '../services/levelup.js';
import { qotdView } from '../services/qotd.js';
import { askTutor, getTutorThread } from '../services/tutor.js';

/** Question of the Day, flagged questions, Level Up and the tutor. */
export const studyRouter = Router();

/** Today's shared question, whether it's answered, and the Question of the Day streak. */
studyRouter.get('/enrollments/:id/qotd', requireAuth, async (req, res) => {
  res.json(await qotdView(currentUser(req)._id, idParam(req)));
});

studyRouter.get('/enrollments/:id/flags', requireAuth, async (req, res) => {
  res.json(await listFlags(currentUser(req)._id, idParam(req)));
});

/** Flags are per question family and idempotent: PUT flags, DELETE unflags. */
studyRouter.put('/flags/:familyId', requireAuth, writeLimiter, async (req, res) => {
  const body = parseBody(req, z.strictObject({ question_version_id: uuidParam }));
  res.json(await flagQuestion(currentUser(req)._id, idParam(req, 'familyId'), body.question_version_id));
});

studyRouter.delete('/flags/:familyId', requireAuth, writeLimiter, async (req, res) => {
  res.json(await unflagQuestion(currentUser(req)._id, idParam(req, 'familyId')));
});

/** Each domain's Level Up progress: Foundations, Applied, Advanced, then Mastery. */
studyRouter.get('/enrollments/:id/level-up', requireAuth, async (req, res) => {
  res.json(await levelUpOverview(currentUser(req)._id, idParam(req)));
});

/** The tutor conversation for one question in one of the learner's sessions. */
studyRouter.get('/tutor/:sessionItemId', requireAuth, async (req, res) => {
  res.json(await getTutorThread(currentUser(req)._id, idParam(req, 'sessionItemId')));
});

/** Guides without giving the answer before the learner answers; discusses freely afterwards. */
studyRouter.post('/tutor/:sessionItemId', requireAuth, aiLimiter, async (req, res) => {
  const body = parseBody(req, z.strictObject({ message: z.string().trim().min(1).max(1000), client_message_id: uuidParam }));
  res.json(await askTutor(currentUser(req)._id, idParam(req, 'sessionItemId'), body));
});
