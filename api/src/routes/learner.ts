import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { Enrollment, Exam, ExamVersion, NotificationJob, NotificationPreference, StreakState } from '../models/index.js';
import { track } from '../lib/analytics.js';
import { conflict, notFound } from '../lib/errors.js';
import { dateParam, idParam, parseBody, uuidParam } from '../lib/http.js';
import { idempotent } from '../lib/idempotency.js';
import { featureSet } from '../services/access.js';
import { enrollmentList } from '../services/account.js';
import { listCatalog } from '../services/content.js';
import { computePath } from '../services/path.js';
import { missedCount, ownedEnrollment, progressReport, reviewQueue } from '../services/progress.js';
import { listActiveSessions } from '../services/sessions.js';
import { mockInventory } from '../services/selection.js';
import { listStories } from '../services/stories.js';

export const learnerRouter = Router();

learnerRouter.get('/exams', async (_req, res) => {
  res.json({ exams: await listCatalog() });
});

learnerRouter.get('/enrollments', requireAuth, async (req, res) => {
  res.json({ enrollments: await enrollmentList(currentUser(req)._id) });
});

/** Only published, pilot/active banks enroll; planned paths cannot start. */
learnerRouter.post('/enrollments', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const body = parseBody(
    req,
    z.strictObject({ exam_version_id: uuidParam, exam_date: dateParam.nullable().optional(), client_request_id: uuidParam }),
  );
  const result = await idempotent(user._id, 'enroll', body.client_request_id, body, async () => {
    const version = await ExamVersion.findOne({ _id: body.exam_version_id, status: 'published' }).lean();
    const exam = version ? await Exam.findById(version.examId).lean() : null;
    if (!version || !exam || !['pilot', 'active'].includes(exam.status)) {
      throw conflict('exam_not_available', 'This exam is planned but not available yet');
    }
    const existing = await Enrollment.findOne({ userId: user._id, examVersionId: version._id }).lean();
    const enrollment =
      existing ??
      (await Enrollment.create({ userId: user._id, examId: exam._id, examVersionId: version._id, examDate: body.exam_date ?? null })).toObject();
    if (!existing) {
      await NotificationPreference.updateOne({ _id: user._id }, { $setOnInsert: { remindersEnabled: false } }, { upsert: true });
      await StreakState.updateOne({ _id: user._id }, { $setOnInsert: { currentDays: 0, longestDays: 0 } }, { upsert: true });
      track('enrollment_created', { userId: user._id, examVersionId: version._id, properties: { exam_date_set: !!body.exam_date } });
    }
    return {
      status: existing ? 200 : 201,
      body: { id: enrollment._id, exam_version_id: enrollment.examVersionId, status: enrollment.status, exam_date: enrollment.examDate ?? null },
    };
  });
  res.status(result.status).json(result.body);
});

/** Exam date edits (including postponing) and pausing or resuming study reminders. */
learnerRouter.patch('/enrollments/:id', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const body = parseBody(req, z.strictObject({ exam_date: dateParam.nullable().optional(), status: z.enum(['active', 'paused']).optional() }));
  const enrollment = await Enrollment.findOneAndUpdate(
    { _id: idParam(req), userId: user._id },
    { $set: { ...(body.exam_date !== undefined && { examDate: body.exam_date }), ...(body.status && { status: body.status }) } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!enrollment) throw notFound('Enrollment');
  if (body.status === 'paused') {
    await NotificationJob.updateMany({ userId: user._id, status: 'queued' }, { $set: { status: 'cancelled', reason: 'paused' } });
  }
  res.json({ id: enrollment._id, exam_version_id: enrollment.examVersionId, status: enrollment.status, exam_date: enrollment.examDate ?? null });
});

learnerRouter.get('/enrollments/:id/path', requireAuth, async (req, res) => {
  const enrollment = await ownedEnrollment(currentUser(req)._id, idParam(req));
  res.json(await computePath(enrollment));
});

learnerRouter.get('/enrollments/:id/reviews', requireAuth, async (req, res) => {
  res.json(await reviewQueue(currentUser(req)._id, idParam(req)));
});

learnerRouter.get('/enrollments/:id/progress', requireAuth, async (req, res) => {
  res.json(await progressReport(currentUser(req)._id, idParam(req)));
});

/** Short workplace stories with questions inline, and whether each is finished or in progress. */
learnerRouter.get('/enrollments/:id/stories', requireAuth, async (req, res) => {
  res.json({ stories: await listStories(currentUser(req)._id, idParam(req)) });
});

/** Practice hub summary: due reviews, missed count, mock inventory and plan features. */
learnerRouter.get('/enrollments/:id/practice', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const enrollment = await ownedEnrollment(user._id, idParam(req));
  const [reviews, missed, mock, features, active] = await Promise.all([
    reviewQueue(user._id, enrollment._id),
    missedCount(user._id, enrollment.examVersionId),
    mockInventory(enrollment.examVersionId),
    featureSet(user._id),
    listActiveSessions(user._id),
  ]);
  res.json({
    enrollment_id: enrollment._id,
    due_review_count: reviews.due_count,
    missed_count: missed,
    mock,
    features: [...features].sort(),
    active_sessions: active.filter((s) => s.enrollment_id === enrollment._id),
  });
});
