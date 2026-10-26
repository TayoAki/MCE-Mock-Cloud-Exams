import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth, requireRole } from '../auth/middleware.js';
import { QuestionFamily, QuestionVersion } from '../models/index.js';
import { dateParam, idParam, parseBody, parseQuery, uuidParam } from '../lib/http.js';
import * as content from '../services/content-admin.js';
import * as ops from '../services/admin-ops.js';
import { reminderStats } from '../services/reminders.js';

/** Private content-review and operations interface. Staff only. */
export const adminRouter = Router();
adminRouter.use('/admin', requireAuth, requireRole('reviewer', 'admin'));
const adminOnly = requireRole('admin');

adminRouter.get('/admin/overview', async (_req, res) => {
  res.json({ ...(await ops.overview()), events: await ops.eventCounts() });
});

/** How each reminder template performs: sends and study days within six hours, across all learners. */
adminRouter.get('/admin/reminders', async (_req, res) => {
  res.json({ templates: await reminderStats() });
});

// ---------- Catalog and blueprint ----------

adminRouter.get('/admin/exams', async (_req, res) => {
  res.json({ exams: await content.listExamsAdmin() });
});

adminRouter.patch('/admin/exams/:id', adminOnly, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({ status: z.enum(['planned', 'pilot', 'active', 'retired']).optional(), title: z.string().min(1).max(120).optional(), subtitle: z.string().max(200).optional() }),
  );
  res.json(await content.updateExam(currentUser(req), idParam(req), body));
});

const versionFields = {
  version_label: z.string().min(1).max(80),
  effective_from: dateParam,
  question_count: z.int().min(1).max(500),
  duration_minutes: z.int().min(1).max(600),
  guide_url: z.url(),
};

adminRouter.post('/admin/exams/:id/versions', adminOnly, async (req, res) => {
  const body = parseBody(req, z.strictObject(versionFields));
  res.status(201).json(await content.createVersion(currentUser(req), idParam(req), body));
});

adminRouter.get('/admin/exam-versions/:id', async (req, res) => {
  res.json(await content.versionDetail(idParam(req)));
});

adminRouter.patch('/admin/exam-versions/:id', adminOnly, async (req, res) => {
  const body = parseBody(req, z.strictObject(versionFields).partial());
  res.json(await content.updateVersion(currentUser(req), idParam(req), body));
});

adminRouter.post('/admin/exam-versions/:id/publish', adminOnly, async (req, res) => {
  res.json(await content.publishVersion(currentUser(req), idParam(req)));
});

adminRouter.post('/admin/exam-versions/:id/domains', adminOnly, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({ id: uuidParam.optional(), code: z.string().min(1).max(40), title: z.string().min(1).max(120), weight_percent: z.number().min(0).max(100), sort_order: z.int().min(1) }),
  );
  res.json(await content.upsertDomain(currentUser(req), idParam(req), body));
});

adminRouter.post('/admin/exam-versions/:id/objectives', async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({ id: uuidParam.optional(), domain_id: uuidParam, code: z.string().min(1).max(80), title: z.string().min(1).max(200), sort_order: z.int().min(1).optional() }),
  );
  res.json(await content.upsertObjective(currentUser(req), idParam(req), body));
});

adminRouter.delete('/admin/exam-versions/:id/domains/:domainId', adminOnly, async (req, res) => {
  res.json(await content.deleteDomain(currentUser(req), idParam(req), idParam(req, 'domainId')));
});

adminRouter.delete('/admin/exam-versions/:id/objectives/:objectiveId', adminOnly, async (req, res) => {
  res.json(await content.deleteObjective(currentUser(req), idParam(req), idParam(req, 'objectiveId')));
});

adminRouter.post('/admin/exam-versions/:id/units', async (req, res) => {
  const body = parseBody(req, z.strictObject({ id: uuidParam.optional(), title: z.string().min(1).max(120), subtitle: z.string().max(200).optional(), sort_order: z.int().min(1) }));
  res.json(await content.upsertUnit(currentUser(req), idParam(req), body));
});

adminRouter.post('/admin/exam-versions/:id/lessons', async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      id: uuidParam.optional(),
      unit_id: uuidParam,
      title: z.string().min(1).max(120),
      summary: z.string().max(300).optional(),
      kind: z.enum(['learn', 'review', 'checkpoint']),
      question_count: z.int().min(1).max(50),
      sort_order: z.int().min(1),
      objective_ids: z.array(uuidParam).max(20),
      pool_family_ids: z.array(uuidParam).max(100),
    }),
  );
  res.json(await content.upsertLesson(currentUser(req), idParam(req), body));
});

adminRouter.post('/admin/lessons/:id/status', async (req, res) => {
  const body = parseBody(req, z.strictObject({ status: z.enum(['draft', 'published', 'retired']) }));
  res.json(await content.setLessonStatus(currentUser(req), idParam(req), body.status));
});

/** Families with their latest revision, for building lesson pools. */
adminRouter.get('/admin/exam-versions/:id/families', async (req, res) => {
  const versionId = idParam(req);
  const [families, revisions] = await Promise.all([
    QuestionFamily.find({ examVersionId: versionId }).sort({ familyKey: 1 }).lean(),
    QuestionVersion.find({ examVersionId: versionId }).sort({ revision: -1 }).select({ familyId: 1, status: 1, prompt: 1, revision: 1 }).lean(),
  ]);
  const latest = new Map<string, (typeof revisions)[number]>();
  for (const r of revisions) if (!latest.has(r.familyId)) latest.set(r.familyId, r);
  const published = new Set(revisions.filter((r) => r.status === 'published').map((r) => r.familyId));
  res.json({
    families: families.map((f) => ({
      id: f._id,
      family_key: f.familyKey,
      objective_id: f.objectiveId,
      latest_revision: latest.get(f._id)?.revision ?? null,
      latest_status: latest.get(f._id)?.status ?? null,
      has_published: published.has(f._id),
      prompt: latest.get(f._id)?.prompt ?? '',
    })),
  });
});

// ---------- Question bank ----------

const optionSchema = z.strictObject({ key: z.string().regex(/^[A-Z]$/), text: z.string().min(1).max(500) });
const questionFields = {
  prompt: z.string().min(10).max(4000),
  answer_type: z.enum(['single', 'multiple']),
  options: z.array(optionSchema).min(2).max(8),
  correct_options: z.array(z.string().regex(/^[A-Z]$/)).min(1).max(8),
  rationale: z.string().min(1).max(4000),
  source_url: z.url(),
  reviewed_notes: z.string().max(2000).optional(),
};

adminRouter.get('/admin/questions', async (req, res) => {
  const query = parseQuery(
    req,
    z.object({
      exam_version_id: uuidParam,
      status: z.enum(['draft', 'published', 'retired']).optional(),
      objective_id: uuidParam.optional(),
      q: z.string().max(100).optional(),
      needs_review: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    }),
  );
  res.json({ questions: await content.listQuestions(query) });
});

adminRouter.post('/admin/questions', async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({
      ...questionFields,
      exam_version_id: uuidParam,
      objective_id: uuidParam,
      family_key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, 'Use lowercase letters, digits and dashes'),
      difficulty: z.int().min(1).max(3).optional(),
    }),
  );
  res.status(201).json(await content.createQuestion(currentUser(req), body));
});

adminRouter.get('/admin/questions/:id', async (req, res) => {
  res.json(await content.questionDetail(idParam(req)));
});

adminRouter.put('/admin/questions/:id', async (req, res) => {
  const body = parseBody(req, z.strictObject(questionFields));
  res.json(await content.updateDraft(currentUser(req), idParam(req), body));
});

adminRouter.post('/admin/questions/:id/review', async (req, res) => {
  const body = parseBody(req, z.strictObject({ note: z.string().max(1000).default('') }));
  res.json(await content.reviewQuestion(currentUser(req), idParam(req), body.note));
});

adminRouter.post('/admin/questions/:id/publish', async (req, res) => {
  res.json(await content.publishQuestion(currentUser(req), idParam(req)));
});

adminRouter.post('/admin/questions/:id/revisions', async (req, res) => {
  const body = parseBody(req, z.strictObject(questionFields));
  res.status(201).json(await content.createRevision(currentUser(req), idParam(req), body));
});

adminRouter.post('/admin/questions/:id/retire', async (req, res) => {
  const body = parseBody(req, z.strictObject({ note: z.string().min(1).max(1000), invalidate_attempts: z.boolean().default(false) }));
  res.json(await content.retireQuestion(currentUser(req), idParam(req), body));
});

// ---------- Operations ----------

adminRouter.get('/admin/issues', async (req, res) => {
  const query = parseQuery(req, z.object({ status: z.enum(['open', 'resolved', 'dismissed']).optional() }));
  res.json({ issues: await ops.listIssues(query.status) });
});

adminRouter.patch('/admin/issues/:id', async (req, res) => {
  const body = parseBody(req, z.strictObject({ status: z.enum(['open', 'resolved', 'dismissed']), resolution: z.string().max(1000).optional() }));
  res.json(await ops.updateIssue(currentUser(req), idParam(req), body));
});

adminRouter.get('/admin/learners', async (req, res) => {
  const query = parseQuery(req, z.object({ q: z.string().max(100).optional() }));
  res.json({ learners: await ops.listLearners(query.q) });
});

adminRouter.get('/admin/learners/:id', async (req, res) => {
  res.json(await ops.learnerDetail(idParam(req)));
});

adminRouter.post('/admin/learners/:id/entitlements', adminOnly, async (req, res) => {
  const body = parseBody(req, z.strictObject({ features: z.array(z.string()).max(4).default([]), days: z.int().min(1).max(366), note: z.string().min(1).max(500) }));
  res.status(201).json(await ops.grantEntitlement(currentUser(req), idParam(req), { ...body, features: ops.parseFeatures(body.features) }));
});

adminRouter.post('/admin/entitlements/:id/revoke', adminOnly, async (req, res) => {
  const body = parseBody(req, z.strictObject({ note: z.string().min(1).max(500) }));
  res.json(await ops.revokeEntitlement(currentUser(req), idParam(req), body.note));
});

adminRouter.get('/admin/staff', async (_req, res) => {
  res.json({ staff: await ops.listStaff() });
});

adminRouter.post('/admin/staff', adminOnly, async (req, res) => {
  const body = parseBody(
    req,
    z.strictObject({ email: z.email().max(254), display_name: z.string().min(1).max(60), password: z.string().min(12).max(200), admin: z.boolean().default(false) }),
  );
  res.status(201).json(await ops.createStaff(currentUser(req), body));
});

adminRouter.get('/admin/outcomes', async (_req, res) => {
  res.json({ outcomes: await ops.listOutcomes() });
});

adminRouter.patch('/admin/outcomes/:id', adminOnly, async (req, res) => {
  const body = parseBody(req, z.strictObject({ verification_status: z.enum(['self_reported', 'evidence_received', 'verified']) }));
  res.json(await ops.verifyOutcome(currentUser(req), idParam(req), body.verification_status));
});

adminRouter.get('/admin/audit', async (req, res) => {
  const query = parseQuery(req, z.object({ entity_type: z.string().max(40).optional(), entity_id: z.string().max(80).optional() }));
  res.json({ entries: await ops.auditLog(query) });
});
