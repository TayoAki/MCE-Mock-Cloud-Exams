import { Router } from 'express';
import { z } from 'zod';
import { currentUser, optionalAuth, requireAuth } from '../auth/middleware.js';
import { IssueReport, ISSUE_REASONS, PracticeSession, PushToken, QuestionVersion } from '../models/index.js';
import { CLIENT_EVENTS, track, type EventName } from '../lib/analytics.js';
import { HttpError, notFound } from '../lib/errors.js';
import { parseBody, uuidParam } from '../lib/http.js';
import { idempotent } from '../lib/idempotency.js';
import { aiLimiter, writeLimiter } from '../lib/rate-limit.js';
import { activeEntitlements, toEntitlement } from '../services/access.js';
import { profileSummary, recordOutcome, requestDeletion, startPreview, updatePreferences, verifyPurchase } from '../services/account.js';
import { explainAttempt } from '../services/explain.js';

export const meRouter = Router();

meRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await profileSummary(currentUser(req)));
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

meRouter.patch('/me/preferences', requireAuth, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      timezone: z.string().min(1).max(64).optional(),
      daily_goal_minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
      reminders_enabled: z.boolean().optional(),
      daily_local_time: hhmm.optional(),
      quiet_start: hhmm.optional(),
      quiet_end: hhmm.optional(),
      weekly_circle_summary: z.boolean().optional(),
      smart_timing: z.boolean().optional(),
      streak_saver: z.boolean().optional(),
      display_name: z.string().min(1).max(60).optional(),
    }),
  );
  res.json(await updatePreferences(currentUser(req), body));
});

meRouter.get('/me/entitlements', requireAuth, async (req, res) => {
  const rows = await activeEntitlements(currentUser(req)._id);
  res.json({ entitlements: rows.map(toEntitlement) });
});

meRouter.post('/me/preview', requireAuth, async (req, res) => {
  const user = currentUser(req);
  const body = parseBody(req, z.strictObject({ accept_terms: z.literal(true), client_request_id: uuidParam }));
  const result = await idempotent(user._id, 'preview', body.client_request_id, body, async () => ({ status: 201, body: await startPreview(user) }));
  res.status(result.status).json(result.body);
});

meRouter.post('/me/push-tokens', requireAuth, async (req, res) => {
  const body = parseBody(req, z.strictObject({ token: z.string().min(10).max(512), platform: z.enum(['ios', 'android', 'web']) }));
  await PushToken.updateOne(
    { token: body.token },
    { $set: { userId: currentUser(req)._id, platform: body.platform, lastSeenAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  res.status(204).end();
});

meRouter.delete('/me/push-tokens', requireAuth, async (req, res) => {
  const body = parseBody(req, z.strictObject({ token: z.string().min(10).max(512) }));
  await PushToken.deleteOne({ token: body.token, userId: currentUser(req)._id });
  res.status(204).end();
});

meRouter.post('/me/deletion-request', requireAuth, async (req, res) => {
  res.status(202).json(await requestDeletion(currentUser(req)));
});

meRouter.post('/explanations', requireAuth, aiLimiter, async (req, res) => {
  const body = parseBody(req, z.strictObject({ attempt_id: uuidParam, style: z.enum(['short', 'analogy', 'comparison']) }));
  res.json(await explainAttempt(currentUser(req)._id, body.attempt_id, body.style));
});

meRouter.post('/store/verify', requireAuth, writeLimiter, async (req, res) => {
  const user = currentUser(req);
  const body = parseBody(
    req,
    z.strictObject({ provider: z.enum(['apple', 'google']), signed_transaction: z.string().min(1).max(20_000), client_request_id: uuidParam }),
  );
  // The idempotency record stores a hash of the body, never the signed token itself.
  const result = await idempotent(user._id, 'store_verify', body.client_request_id, body, async () => ({
    status: 200,
    body: await verifyPurchase(user, body),
  }));
  res.status(result.status).json(result.body);
});

meRouter.post('/exam-outcomes', requireAuth, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      enrollment_id: uuidParam,
      result: z.enum(['passed', 'failed']),
      taken_at: z.iso.datetime({ offset: true }),
      pause_reminders: z.boolean(),
      client_request_id: uuidParam,
    }),
  );
  res.status(201).json(await recordOutcome(currentUser(req), body));
});

/** "Report an issue" keeps the attempt and queues the question for staff review. */
meRouter.post('/issue-reports', requireAuth, writeLimiter, async (req, res) => {
  const user = currentUser(req);
  const body = parseBody(
    req,
    z.strictObject({
      question_version_id: uuidParam,
      attempt_id: uuidParam.optional(),
      reason: z.enum(ISSUE_REASONS),
      note: z.string().max(1000).optional(),
    }),
  );
  const seen = await PracticeSession.exists({ userId: user._id, 'items.questionVersionId': body.question_version_id });
  const question = await QuestionVersion.findById(body.question_version_id).select({ examVersionId: 1 }).lean();
  if (!seen || !question) throw notFound('Question');
  const today = await IssueReport.countDocuments({ userId: user._id, createdAt: { $gte: new Date(Date.now() - 86_400_000) } });
  if (today >= 20) throw new HttpError(429, 'rate_limited', 'Thanks for the reports. Please try again tomorrow.');
  const report = await IssueReport.create({
    userId: user._id,
    questionVersionId: body.question_version_id,
    examVersionId: question.examVersionId,
    attemptId: body.attempt_id ?? null,
    reason: body.reason,
    note: body.note ?? '',
  });
  track('issue_reported', { userId: user._id, properties: { reason: body.reason } });
  res.status(201).json({ id: report._id, status: report.status });
});

/** Client analytics: allowlisted event names and properties only. */
meRouter.post('/events', optionalAuth, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      anonymous_id: uuidParam.optional(),
      source_version: z.string().max(40).optional(),
      events: z
        .array(
          z.strictObject({
            name: z.enum(CLIENT_EVENTS as [EventName, ...EventName[]]),
            occurred_at: z.iso.datetime({ offset: true }).optional(),
            properties: z.record(z.string(), z.union([z.string().max(64), z.number(), z.boolean(), z.null()])).optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
  );
  for (const e of body.events) {
    track(e.name, {
      userId: req.user?._id ?? null,
      anonymousId: body.anonymous_id ?? null,
      occurredAt: e.occurred_at ? new Date(e.occurred_at) : undefined,
      sourceVersion: body.source_version,
      properties: e.properties,
    });
  }
  res.status(202).json({ accepted: body.events.length });
});
