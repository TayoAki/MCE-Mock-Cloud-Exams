import { tx } from '../db.js';
import {
  Attempt,
  ContentAudit,
  Domain,
  Exam,
  ExamVersion,
  IssueReport,
  Lesson,
  Objective,
  ObjectiveProgress,
  QuestionFamily,
  QuestionKey,
  QuestionVersion,
  Unit,
  User,
  type UserRecord,
} from '../models/index.js';
import { config } from '../config.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { allocateBlueprint } from '../lib/rules.js';
import { keyMatchPairs, keyOrderSteps } from '../lib/answers.js';
import type { AnswerType } from '../models/bank.js';

type Actor = Pick<UserRecord, '_id' | 'roles'>;

export async function audit(
  actor: Actor,
  entityType: 'question_version' | 'exam_version' | 'lesson' | 'issue_report' | 'entitlement' | 'exam_outcome' | 'user',
  entityId: string,
  action: string,
  note = '',
  details: Record<string, unknown> = {},
) {
  await ContentAudit.create([{ actorId: actor._id, entityType, entityId, action, note, details }]);
}

// ---------- Exams and versions ----------

export async function listExamsAdmin() {
  const [exams, versions] = await Promise.all([Exam.find().sort({ sortOrder: 1 }).lean(), ExamVersion.find().sort({ effectiveFrom: -1 }).lean()]);
  return exams.map((e) => ({
    id: e._id,
    slug: e.slug,
    title: e.title,
    subtitle: e.subtitle,
    provider: e.provider,
    status: e.status,
    canonical_url: e.canonicalUrl,
    versions: versions
      .filter((v) => v.examId === e._id)
      .map((v) => ({ id: v._id, version_label: v.versionLabel, status: v.status, effective_from: v.effectiveFrom })),
  }));
}

export async function updateExam(actor: Actor, examId: string, input: { status?: string; title?: string; subtitle?: string }) {
  const exam = await Exam.findByIdAndUpdate(examId, { $set: input }, { returnDocument: 'after', runValidators: true }).lean();
  if (!exam) throw notFound('Exam');
  await audit(actor, 'exam_version', examId, 'exam_updated', '', input);
  return (await listExamsAdmin()).find((e) => e.id === examId)!;
}

export async function createVersion(
  actor: Actor,
  examId: string,
  input: { version_label: string; effective_from: string; question_count: number; duration_minutes: number; guide_url: string },
) {
  if (!(await Exam.exists({ _id: examId }))) throw notFound('Exam');
  const version = await ExamVersion.create({
    examId,
    versionLabel: input.version_label,
    effectiveFrom: input.effective_from,
    questionCount: input.question_count,
    durationMinutes: input.duration_minutes,
    guideUrl: input.guide_url,
  });
  await audit(actor, 'exam_version', version._id, 'created');
  return versionDetail(version._id);
}

async function draftVersion(versionId: string) {
  const version = await ExamVersion.findById(versionId).lean();
  if (!version) throw notFound('Exam version');
  if (version.status !== 'draft') throw conflict('version_locked', 'Published blueprints are immutable; create a new version instead');
  return version;
}

export async function updateVersion(
  actor: Actor,
  versionId: string,
  input: Partial<{ version_label: string; effective_from: string; question_count: number; duration_minutes: number; guide_url: string }>,
) {
  await draftVersion(versionId);
  const set: Record<string, unknown> = {};
  if (input.version_label !== undefined) set.versionLabel = input.version_label;
  if (input.effective_from !== undefined) set.effectiveFrom = input.effective_from;
  if (input.question_count !== undefined) set.questionCount = input.question_count;
  if (input.duration_minutes !== undefined) set.durationMinutes = input.duration_minutes;
  if (input.guide_url !== undefined) set.guideUrl = input.guide_url;
  await ExamVersion.updateOne({ _id: versionId }, { $set: set }, { runValidators: true });
  await audit(actor, 'exam_version', versionId, 'updated', '', input);
  return versionDetail(versionId);
}

export async function upsertDomain(
  actor: Actor,
  versionId: string,
  input: { id?: string; code: string; title: string; weight_percent: number; sort_order: number },
) {
  await draftVersion(versionId);
  const fields = { code: input.code, title: input.title, weightPercent: input.weight_percent, sortOrder: input.sort_order };
  if (input.id) {
    const res = await Domain.updateOne({ _id: input.id, examVersionId: versionId }, { $set: fields }, { runValidators: true });
    if (!res.matchedCount) throw notFound('Domain');
  } else {
    await Domain.create({ examVersionId: versionId, ...fields });
  }
  await audit(actor, 'exam_version', versionId, 'domain_saved', '', fields);
  return versionDetail(versionId);
}

export async function upsertObjective(
  actor: Actor,
  versionId: string,
  input: { id?: string; domain_id: string; code: string; title: string; sort_order?: number },
) {
  await draftVersion(versionId);
  if (!(await Domain.exists({ _id: input.domain_id, examVersionId: versionId }))) throw badRequest('invalid_domain', 'Domain is not in this version');
  const fields = { domainId: input.domain_id, code: input.code, title: input.title, sortOrder: input.sort_order ?? 1 };
  if (input.id) {
    const res = await Objective.updateOne({ _id: input.id, examVersionId: versionId }, { $set: fields }, { runValidators: true });
    if (!res.matchedCount) throw notFound('Objective');
  } else {
    await Objective.create({ examVersionId: versionId, ...fields });
  }
  await audit(actor, 'exam_version', versionId, 'objective_saved', '', fields);
  return versionDetail(versionId);
}

export async function deleteDomain(actor: Actor, versionId: string, domainId: string) {
  await draftVersion(versionId);
  if (await Objective.exists({ domainId })) throw conflict('domain_in_use', 'Remove or move its objectives first');
  const res = await Domain.deleteOne({ _id: domainId, examVersionId: versionId });
  if (!res.deletedCount) throw notFound('Domain');
  await audit(actor, 'exam_version', versionId, 'domain_deleted', '', { domain_id: domainId });
  return versionDetail(versionId);
}

export async function deleteObjective(actor: Actor, versionId: string, objectiveId: string) {
  await draftVersion(versionId);
  if (await QuestionFamily.exists({ objectiveId })) throw conflict('objective_in_use', 'Questions are mapped to this objective');
  if (await Lesson.exists({ objectiveIds: objectiveId })) throw conflict('objective_in_use', 'A lesson covers this objective');
  const res = await Objective.deleteOne({ _id: objectiveId, examVersionId: versionId });
  if (!res.deletedCount) throw notFound('Objective');
  await audit(actor, 'exam_version', versionId, 'objective_deleted', '', { objective_id: objectiveId });
  return versionDetail(versionId);
}

export async function upsertUnit(actor: Actor, versionId: string, input: { id?: string; title: string; subtitle?: string; sort_order: number }) {
  if (!(await ExamVersion.exists({ _id: versionId }))) throw notFound('Exam version');
  const fields = { title: input.title, subtitle: input.subtitle ?? '', sortOrder: input.sort_order };
  if (input.id) {
    const res = await Unit.updateOne({ _id: input.id, examVersionId: versionId }, { $set: fields }, { runValidators: true });
    if (!res.matchedCount) throw notFound('Unit');
  } else {
    await Unit.create({ examVersionId: versionId, ...fields });
  }
  await audit(actor, 'exam_version', versionId, 'unit_saved', '', fields);
  return versionDetail(versionId);
}

export async function upsertLesson(
  actor: Actor,
  versionId: string,
  input: {
    id?: string;
    unit_id: string;
    title: string;
    summary?: string;
    kind: 'learn' | 'review' | 'checkpoint';
    question_count: number;
    sort_order: number;
    objective_ids: string[];
    pool_family_ids: string[];
  },
) {
  if (!(await Unit.exists({ _id: input.unit_id, examVersionId: versionId }))) throw badRequest('invalid_unit', 'Unit is not in this version');
  const objectiveCount = await Objective.countDocuments({ _id: { $in: input.objective_ids }, examVersionId: versionId });
  if (objectiveCount !== new Set(input.objective_ids).size) throw badRequest('invalid_objective', 'Every objective must belong to this version');
  const familyCount = await QuestionFamily.countDocuments({ _id: { $in: input.pool_family_ids }, examVersionId: versionId });
  if (familyCount !== new Set(input.pool_family_ids).size) throw badRequest('invalid_family', 'Every pooled family must belong to this version');
  const fields = {
    unitId: input.unit_id,
    title: input.title,
    summary: input.summary ?? '',
    kind: input.kind,
    questionCount: input.question_count,
    sortOrder: input.sort_order,
    objectiveIds: input.objective_ids,
    poolFamilyIds: [...new Set(input.pool_family_ids)],
  };
  let lessonId = input.id;
  if (lessonId) {
    const res = await Lesson.updateOne({ _id: lessonId, examVersionId: versionId }, { $set: fields }, { runValidators: true });
    if (!res.matchedCount) throw notFound('Lesson');
  } else {
    lessonId = (await Lesson.create({ examVersionId: versionId, ...fields }))._id;
  }
  await audit(actor, 'lesson', lessonId, input.id ? 'updated' : 'created');
  return versionDetail(versionId);
}

export async function setLessonStatus(actor: Actor, lessonId: string, status: 'published' | 'retired' | 'draft') {
  const lesson = await Lesson.findById(lessonId).lean();
  if (!lesson) throw notFound('Lesson');
  if (status === 'published') {
    const published = await QuestionVersion.distinct('familyId', { familyId: { $in: lesson.poolFamilyIds }, status: 'published' });
    if (published.length === 0) throw conflict('lesson_not_ready', 'A lesson needs at least one published question in its pool');
  }
  await Lesson.updateOne({ _id: lessonId }, { $set: { status } });
  await audit(actor, 'lesson', lessonId, `status_${status}`);
  return versionDetail(lesson.examVersionId);
}

/** Readiness checklist. Blocking checks gate publication; warnings inform. */
export async function versionReadiness(versionId: string) {
  const version = await ExamVersion.findById(versionId).lean();
  if (!version) throw notFound('Exam version');
  const [domains, objectives, published, lessons] = await Promise.all([
    Domain.find({ examVersionId: versionId }).sort({ sortOrder: 1 }).lean(),
    Objective.find({ examVersionId: versionId }).lean(),
    QuestionVersion.find({ examVersionId: versionId, status: 'published' }).select({ objectiveId: 1, domainId: 1, familyId: 1 }).lean(),
    Lesson.find({ examVersionId: versionId, status: 'published' }).lean(),
  ]);
  const weightTotal = domains.reduce((s, d) => s + d.weightPercent, 0);
  const objectivesWithContent = new Set(published.map((q) => q.objectiveId));
  const families = new Set(published.map((q) => q.familyId));
  const domainsWithoutObjectives = domains.filter((d) => !objectives.some((o) => o.domainId === d._id));
  const emptyObjectives = objectives.filter((o) => !objectivesWithContent.has(o._id));
  const emptyLessons = lessons.filter((l) => !l.poolFamilyIds.some((f) => families.has(f)));
  let mockShortfall: { domain: string; required: number; available: number }[] = [];
  if (Math.abs(weightTotal - 100) < 1e-6 && domains.length) {
    const allocation = allocateBlueprint(version.questionCount, domains.map((d) => d.weightPercent));
    mockShortfall = domains
      .map((d, i) => ({ domain: d.title, required: allocation[i]!, available: new Set(published.filter((q) => q.domainId === d._id).map((q) => q.familyId)).size }))
      .filter((r) => r.available < r.required);
  }
  const checks = [
    { key: 'weights_total_100', blocking: true, ok: Math.abs(weightTotal - 100) < 1e-6, detail: `Domain weights total ${weightTotal}%` },
    { key: 'domains_have_objectives', blocking: true, ok: domains.length > 0 && domainsWithoutObjectives.length === 0, detail: domainsWithoutObjectives.length ? `No objectives: ${domainsWithoutObjectives.map((d) => d.title).join(', ')}` : `${objectives.length} ${objectives.length === 1 ? 'objective' : 'objectives'} mapped` },
    { key: 'published_lesson', blocking: true, ok: lessons.length > 0 && emptyLessons.length === 0, detail: emptyLessons.length ? `Lessons without published questions: ${emptyLessons.map((l) => l.title).join(', ')}` : `${lessons.length} published ${lessons.length === 1 ? 'lesson' : 'lessons'}` },
    { key: 'objective_coverage', blocking: false, ok: emptyObjectives.length === 0, detail: emptyObjectives.length ? `${emptyObjectives.length} ${emptyObjectives.length === 1 ? 'objective has' : 'objectives have'} no published questions` : 'Every objective has published questions' },
    { key: 'full_mock_inventory', blocking: false, ok: mockShortfall.length === 0, detail: mockShortfall.length ? `Full mock short in: ${mockShortfall.map((s) => `${s.domain} ${s.available}/${s.required}`).join(', ')}` : `A ${version.questionCount}-question form can be assembled` },
  ];
  return { ready: checks.filter((c) => c.blocking).every((c) => c.ok), checks, published_questions: published.length };
}

export async function publishVersion(actor: Actor, versionId: string) {
  await draftVersion(versionId);
  const readiness = await versionReadiness(versionId);
  if (!readiness.ready) throw conflict('version_not_ready', 'Resolve the blocking checks before publishing', { checks: readiness.checks });
  await ExamVersion.updateOne({ _id: versionId }, { $set: { status: 'published', publishedAt: new Date(), publishedBy: actor._id } });
  await audit(actor, 'exam_version', versionId, 'published');
  return versionDetail(versionId);
}

export async function versionDetail(versionId: string) {
  const version = await ExamVersion.findById(versionId).lean();
  if (!version) throw notFound('Exam version');
  const [exam, domains, objectives, units, lessons, counts, readiness] = await Promise.all([
    Exam.findById(version.examId).lean(),
    Domain.find({ examVersionId: versionId }).sort({ sortOrder: 1 }).lean(),
    Objective.find({ examVersionId: versionId }).sort({ sortOrder: 1, code: 1 }).lean(),
    Unit.find({ examVersionId: versionId }).sort({ sortOrder: 1 }).lean(),
    Lesson.find({ examVersionId: versionId }).sort({ sortOrder: 1 }).lean(),
    QuestionVersion.aggregate<{ _id: { objectiveId: string; status: string }; n: number }>([
      { $match: { examVersionId: versionId } },
      { $group: { _id: { objectiveId: '$objectiveId', status: '$status' }, n: { $sum: 1 } } },
    ]),
    versionReadiness(versionId),
  ]);
  const countFor = (objectiveId: string, status: string) => counts.find((c) => c._id.objectiveId === objectiveId && c._id.status === status)?.n ?? 0;
  return {
    id: version._id,
    exam: exam ? { id: exam._id, title: exam.title, status: exam.status } : null,
    version_label: version.versionLabel,
    status: version.status,
    effective_from: version.effectiveFrom,
    question_count: version.questionCount,
    duration_minutes: version.durationMinutes,
    guide_url: version.guideUrl,
    domains: domains.map((d) => ({
      id: d._id,
      code: d.code,
      title: d.title,
      weight_percent: d.weightPercent,
      sort_order: d.sortOrder,
      objectives: objectives
        .filter((o) => o.domainId === d._id)
        .map((o) => ({ id: o._id, code: o.code, title: o.title, published: countFor(o._id, 'published'), drafts: countFor(o._id, 'draft') })),
    })),
    units: units.map((u) => ({
      id: u._id,
      title: u.title,
      subtitle: u.subtitle,
      sort_order: u.sortOrder,
      lessons: lessons
        .filter((l) => l.unitId === u._id)
        .map((l) => ({
          id: l._id,
          title: l.title,
          summary: l.summary,
          kind: l.kind,
          status: l.status,
          question_count: l.questionCount,
          sort_order: l.sortOrder,
          objective_ids: l.objectiveIds,
          pool_family_ids: l.poolFamilyIds,
        })),
    })),
    readiness,
  };
}

// ---------- Questions ----------

/**
 * Authoring input. Order questions list options in their correct order with
 * correct_options in that same order; match questions give aligned options and
 * match_targets with "A=1" pairs. The server re-keys both so stored keys never
 * reveal the answer.
 */
interface QuestionInput {
  prompt: string;
  answer_type: AnswerType;
  options: { key: string; text: string }[];
  match_targets?: { key: string; text: string }[];
  correct_options: string[];
  accepted_answers?: string[];
  presentation?: 'text' | 'listen';
  input_hint?: string | null;
  rationale: string;
  source_url: string;
  reviewed_notes?: string;
}

/** The stored form of a validated input: re-keyed order steps and match targets, trimmed typed answers. */
function prepareQuestion(input: QuestionInput) {
  const base = { presentation: input.presentation ?? 'text', inputHint: input.input_hint?.trim() || null };
  if (input.answer_type === 'order') {
    const byKey = new Map(input.options.map((o) => [o.key, o.text.trim()]));
    const keyed = keyOrderSteps(input.correct_options.map((k) => byKey.get(k)!));
    return { ...base, options: keyed.options, matchTargets: [], correctOptions: keyed.correct, acceptedAnswers: [] };
  }
  if (input.answer_type === 'match') {
    const left = new Map(input.options.map((o) => [o.key, o.text.trim()]));
    const right = new Map((input.match_targets ?? []).map((t) => [t.key, t.text.trim()]));
    const pairs = [...input.correct_options].sort().map((p) => {
      const [l, r] = p.split('=');
      return { left: left.get(l!)!, right: right.get(r!)! };
    });
    const keyed = keyMatchPairs(pairs);
    return { ...base, options: keyed.options, matchTargets: keyed.targets, correctOptions: keyed.correct, acceptedAnswers: [] };
  }
  if (input.answer_type === 'type') {
    const accepted = [...new Set((input.accepted_answers ?? []).map((a) => a.trim()).filter(Boolean))];
    return { ...base, options: [], matchTargets: [], correctOptions: [], acceptedAnswers: accepted };
  }
  return {
    ...base,
    options: input.options.map((o) => ({ key: o.key, text: o.text })),
    matchTargets: [],
    correctOptions: [...new Set(input.correct_options)].sort(),
    acceptedAnswers: [],
  };
}

function toQuestionRow(q: { _id: string; familyId: string; examVersionId: string; revision: number; prompt: string; status: string; objectiveId: string; domainId: string; reviewedBy?: string | null; createdAt: Date; answerType: string }) {
  return {
    id: q._id,
    exam_version_id: q.examVersionId,
    family_id: q.familyId,
    revision: q.revision,
    prompt: q.prompt,
    status: q.status,
    answer_type: q.answerType,
    objective_id: q.objectiveId,
    domain_id: q.domainId,
    reviewed: !!q.reviewedBy,
    created_at: q.createdAt.toISOString(),
  };
}

export async function listQuestions(filter: { exam_version_id: string; status?: string; objective_id?: string; q?: string; needs_review?: boolean }) {
  const query: Record<string, unknown> = { examVersionId: filter.exam_version_id };
  if (filter.status) query.status = filter.status;
  if (filter.objective_id) query.objectiveId = filter.objective_id;
  if (filter.needs_review) Object.assign(query, { status: 'draft', reviewedBy: null });
  if (filter.q) query.prompt = { $regex: filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const rows = await QuestionVersion.find(query).sort({ createdAt: -1 }).limit(500).lean();
  const [families, openIssues] = await Promise.all([
    QuestionFamily.find({ _id: { $in: [...new Set(rows.map((r) => r.familyId))] } }).select({ familyKey: 1 }).lean(),
    IssueReport.aggregate<{ _id: string; n: number }>([
      { $match: { questionVersionId: { $in: rows.map((r) => r._id) }, status: 'open' } },
      { $group: { _id: '$questionVersionId', n: { $sum: 1 } } },
    ]),
  ]);
  const keys = new Map(families.map((f) => [f._id, f.familyKey]));
  const issues = new Map(openIssues.map((i) => [i._id, i.n]));
  return rows.map((r) => ({ ...toQuestionRow(r), family_key: keys.get(r.familyId) ?? '', open_issues: issues.get(r._id) ?? 0 }));
}

export async function questionDetail(questionVersionId: string) {
  const q = await QuestionVersion.findById(questionVersionId).lean();
  if (!q) throw notFound('Question');
  const [key, family, revisions, auditTrail, issues, attemptStats] = await Promise.all([
    QuestionKey.findById(q._id).lean(),
    QuestionFamily.findById(q.familyId).lean(),
    QuestionVersion.find({ familyId: q.familyId }).sort({ revision: -1 }).select({ revision: 1, status: 1, createdAt: 1 }).lean(),
    ContentAudit.find({ entityType: 'question_version', entityId: q._id }).sort({ recordedAt: -1 }).lean(),
    IssueReport.find({ questionVersionId: q._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Attempt.aggregate<{ _id: null; total: number; correct: number }>([
      { $match: { questionVersionId: q._id, gradedAt: { $ne: null }, invalidatedAt: null } },
      { $group: { _id: null, total: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } } } },
    ]),
  ]);
  const actors = new Map(
    (await User.find({ _id: { $in: [...new Set(auditTrail.map((a) => a.actorId))] } }).select({ displayName: 1 }).lean()).map((u) => [u._id, u.displayName]),
  );
  return {
    ...toQuestionRow(q),
    family_key: family?.familyKey ?? '',
    difficulty: family?.difficulty ?? 1,
    options: q.options.map((o) => ({ key: o.key, text: o.text })),
    match_targets: (q.matchTargets ?? []).map((t) => ({ key: t.key, text: t.text })),
    presentation: q.presentation ?? 'text',
    input_hint: q.inputHint ?? null,
    story_id: q.storyId ?? null,
    source_url: q.sourceUrl,
    correct_options: key?.correctOptions ?? [],
    accepted_answers: key?.acceptedAnswers ?? [],
    rationale: key?.rationale ?? '',
    reviewed_notes: key?.reviewedNotes ?? '',
    reviewed_by: q.reviewedBy ?? null,
    reviewed_at: q.reviewedAt?.toISOString() ?? null,
    created_by: q.createdBy ?? null,
    published_at: q.publishedAt?.toISOString() ?? null,
    revisions: revisions.map((r) => ({ id: r._id, revision: r.revision, status: r.status, created_at: r.createdAt.toISOString() })),
    audit: auditTrail.map((a) => ({ action: a.action, actor_id: a.actorId, actor: actors.get(a.actorId) ?? a.actorId, note: a.note, recorded_at: a.recordedAt.toISOString() })),
    issues: issues.map((i) => ({ id: i._id, reason: i.reason, note: i.note, status: i.status, created_at: i.createdAt.toISOString() })),
    attempts: { total: attemptStats[0]?.total ?? 0, correct: attemptStats[0]?.correct ?? 0 },
  };
}

/** Structural publication checks (also enforced again at publish time). */
function validateQuestion(input: QuestionInput) {
  const problems: string[] = [];
  const keys = input.options.map((o) => o.key);
  const type = input.answer_type;
  if (type === 'type') {
    const accepted = (input.accepted_answers ?? []).map((a) => a.trim()).filter(Boolean);
    if (input.options.length) problems.push('A typed-answer question has no options');
    if (!accepted.length) problems.push('Add at least one accepted answer');
    if (accepted.some((a) => a.length > 100)) problems.push('Accepted answers must be short (100 characters at most)');
  } else {
    if (input.options.length < 2) problems.push('At least two options are required');
    if (new Set(keys).size !== keys.length) problems.push('Option keys must be unique');
    if (input.options.some((o) => !o.text.trim())) problems.push('Every option needs text');
  }
  const correct = new Set(input.correct_options);
  if (type === 'single' || type === 'multiple') {
    if ([...correct].some((k) => !keys.includes(k))) problems.push('Correct options must be among the options');
    if (type === 'single' && correct.size !== 1) problems.push('A single-answer question needs exactly one correct option');
    if (type === 'multiple' && correct.size < 1) problems.push('A multiple-answer question needs at least one correct option');
  }
  if (type === 'order') {
    if (input.options.length < 3 || input.options.length > 8) problems.push('An order question needs 3 to 8 steps');
    if (input.correct_options.length !== keys.length || correct.size !== keys.length || [...correct].some((k) => !keys.includes(k))) {
      problems.push('The correct order must list every step exactly once');
    }
  }
  if (type === 'match') {
    const targets = (input.match_targets ?? []).map((t) => t.key);
    if (input.options.length > 6) problems.push('A match question has at most 6 pairs');
    if (targets.length !== keys.length) problems.push('Each item needs exactly one match');
    if ((input.match_targets ?? []).some((t) => !t.text.trim())) problems.push('Every match needs text');
    const lefts = input.correct_options.map((p) => p.split('=')[0]);
    const rights = input.correct_options.map((p) => p.split('=')[1]);
    if (
      input.correct_options.length !== keys.length ||
      new Set(lefts).size !== keys.length ||
      new Set(rights).size !== keys.length ||
      lefts.some((l) => !keys.includes(l!)) ||
      rights.some((r) => !targets.includes(r!))
    ) {
      problems.push('Pair every item with a different match');
    }
  }
  if (!input.rationale.trim()) problems.push('A reviewed rationale is required');
  if (!/^https?:\/\/\S+$/.test(input.source_url)) problems.push('A source URL is required');
  if (input.prompt.trim().length < 10) problems.push('The prompt is too short');
  return problems;
}

function requireValid(input: QuestionInput) {
  const problems = validateQuestion(input);
  if (problems.length) throw badRequest('question_invalid', problems[0]!, { problems });
}

export async function createQuestion(
  actor: Actor,
  input: QuestionInput & { exam_version_id: string; objective_id: string; family_key: string; difficulty?: number },
) {
  requireValid(input);
  const prepared = prepareQuestion(input);
  const objective = await Objective.findOne({ _id: input.objective_id, examVersionId: input.exam_version_id }).lean();
  if (!objective) throw badRequest('invalid_objective', 'Objective is not in this exam version');
  const id = await tx(async () => {
    const [family] = await QuestionFamily.create([
      { examVersionId: input.exam_version_id, objectiveId: objective._id, familyKey: input.family_key, difficulty: input.difficulty ?? 1, createdBy: actor._id },
    ]);
    const [qv] = await QuestionVersion.create([
      {
        familyId: family!._id,
        examVersionId: input.exam_version_id,
        objectiveId: objective._id,
        domainId: objective.domainId,
        revision: 1,
        prompt: input.prompt.trim(),
        answerType: input.answer_type,
        options: prepared.options,
        matchTargets: prepared.matchTargets,
        presentation: prepared.presentation,
        inputHint: prepared.inputHint,
        sourceUrl: input.source_url,
        createdBy: actor._id,
      },
    ]);
    await QuestionKey.create([
      { _id: qv!._id, correctOptions: prepared.correctOptions, acceptedAnswers: prepared.acceptedAnswers, rationale: input.rationale.trim(), reviewedNotes: input.reviewed_notes ?? '' },
    ]);
    await audit(actor, 'question_version', qv!._id, 'created');
    return qv!._id;
  });
  return questionDetail(id);
}

/** Drafts are editable; any edit clears a prior review so it must be reviewed again. */
export async function updateDraft(actor: Actor, questionVersionId: string, input: QuestionInput) {
  requireValid(input);
  const prepared = prepareQuestion(input);
  await tx(async () => {
    const q = await QuestionVersion.findById(questionVersionId);
    if (!q) throw notFound('Question');
    if (q.status !== 'draft') throw conflict('question_immutable', 'Published and retired revisions are immutable; create a new revision');
    q.prompt = input.prompt.trim();
    q.answerType = input.answer_type;
    q.set('options', prepared.options);
    q.set('matchTargets', prepared.matchTargets);
    q.presentation = prepared.presentation;
    q.inputHint = prepared.inputHint;
    q.sourceUrl = input.source_url;
    q.reviewedBy = null;
    q.reviewedAt = null;
    await q.save();
    await QuestionKey.updateOne(
      { _id: q._id },
      {
        $set: {
          correctOptions: prepared.correctOptions,
          acceptedAnswers: prepared.acceptedAnswers,
          rationale: input.rationale.trim(),
          reviewedNotes: input.reviewed_notes ?? '',
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    await audit(actor, 'question_version', q._id, 'edited');
  });
  return questionDetail(questionVersionId);
}

export async function reviewQuestion(actor: Actor, questionVersionId: string, note: string) {
  const q = await QuestionVersion.findById(questionVersionId);
  if (!q) throw notFound('Question');
  if (q.status !== 'draft') throw conflict('question_not_draft', 'Only drafts can be reviewed');
  if (config.SEPARATE_REVIEWER && q.createdBy === actor._id) {
    throw conflict('self_review', 'A different reviewer must approve this question');
  }
  q.reviewedBy = actor._id;
  q.reviewedAt = new Date();
  await q.save();
  await audit(actor, 'question_version', q._id, 'reviewed', note);
  return questionDetail(questionVersionId);
}

/**
 * Publication transaction: re-verifies structure, mapping and review, publishes
 * the revision and retires the family's previous published revision for new sessions.
 */
export async function publishQuestion(actor: Actor, questionVersionId: string) {
  await tx(async () => {
    const q = await QuestionVersion.findById(questionVersionId);
    if (!q) throw notFound('Question');
    if (q.status !== 'draft') throw conflict('question_not_draft', 'Only drafts can be published');
    if (!q.reviewedBy || !q.reviewedAt) throw conflict('review_required', 'A reviewer must approve this question before publishing');
    const key = await QuestionKey.findById(q._id).lean();
    if (!key) throw conflict('key_missing', 'The answer key is missing');
    const problems = validateQuestion({
      prompt: q.prompt,
      answer_type: q.answerType as AnswerType,
      options: q.options.map((o) => ({ key: o.key, text: o.text })),
      match_targets: (q.matchTargets ?? []).map((t) => ({ key: t.key, text: t.text })),
      correct_options: key.correctOptions,
      accepted_answers: key.acceptedAnswers ?? [],
      rationale: key.rationale,
      source_url: q.sourceUrl,
    });
    if (problems.length) throw badRequest('question_invalid', problems[0]!, { problems });
    const objective = await Objective.findOne({ _id: q.objectiveId, examVersionId: q.examVersionId }).lean();
    if (!objective || objective.domainId !== q.domainId) throw conflict('mapping_invalid', 'The objective mapping is no longer valid');

    const previous = await QuestionVersion.find({ familyId: q.familyId, status: 'published', _id: { $ne: q._id } });
    for (const p of previous) {
      p.status = 'retired';
      p.retiredAt = new Date();
      await p.save();
      await audit(actor, 'question_version', p._id, 'retired', `Superseded by revision ${q.revision}`);
    }
    q.status = 'published';
    q.publishedAt = new Date();
    await q.save();
    await audit(actor, 'question_version', q._id, 'published');
  });
  return questionDetail(questionVersionId);
}

/** A new draft revision copied from any revision in the family, with edits applied. */
export async function createRevision(actor: Actor, questionVersionId: string, input: QuestionInput) {
  requireValid(input);
  const prepared = prepareQuestion(input);
  const id = await tx(async () => {
    const base = await QuestionVersion.findById(questionVersionId).lean();
    if (!base) throw notFound('Question');
    const latest = await QuestionVersion.findOne({ familyId: base.familyId }).sort({ revision: -1 }).lean();
    if (latest?.status === 'draft') throw conflict('draft_exists', 'This family already has a draft revision', { draft_id: latest._id });
    const [qv] = await QuestionVersion.create([
      {
        familyId: base.familyId,
        examVersionId: base.examVersionId,
        objectiveId: base.objectiveId,
        domainId: base.domainId,
        revision: (latest?.revision ?? base.revision) + 1,
        prompt: input.prompt.trim(),
        answerType: input.answer_type,
        options: prepared.options,
        matchTargets: prepared.matchTargets,
        presentation: prepared.presentation,
        inputHint: prepared.inputHint,
        storyId: base.storyId ?? null,
        sourceUrl: input.source_url,
        createdBy: actor._id,
      },
    ]);
    await QuestionKey.create([
      { _id: qv!._id, correctOptions: prepared.correctOptions, acceptedAnswers: prepared.acceptedAnswers, rationale: input.rationale.trim(), reviewedNotes: input.reviewed_notes ?? '' },
    ]);
    await audit(actor, 'question_version', qv!._id, 'created', `Revision of ${base._id}`);
    return qv!._id;
  });
  return questionDetail(id);
}

/** Recomputes objective counters from attempts, excluding invalidated ones. */
async function recomputeObjectiveProgress(enrollmentId: string, objectiveId: string) {
  const [agg] = await Attempt.aggregate<{ total: number; correct: number; fsTotal: number; fsCorrect: number; last: Date }>([
    { $match: { enrollmentId, objectiveId, gradedAt: { $ne: null }, invalidatedAt: null } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        correct: { $sum: { $cond: ['$isCorrect', 1, 0] } },
        fsTotal: { $sum: { $cond: ['$firstSeenFamily', 1, 0] } },
        fsCorrect: { $sum: { $cond: [{ $and: ['$firstSeenFamily', '$isCorrect'] }, 1, 0] } },
        last: { $max: '$gradedAt' },
      },
    },
  ]);
  await ObjectiveProgress.updateOne(
    { enrollmentId, objectiveId },
    {
      $set: {
        totalAttempts: agg?.total ?? 0,
        totalCorrect: agg?.correct ?? 0,
        firstSeenTotal: agg?.fsTotal ?? 0,
        firstSeenCorrect: agg?.fsCorrect ?? 0,
        ...(agg?.last ? { lastPracticedAt: agg.last } : {}),
      },
    },
  );
}

/**
 * Retires a revision for new sessions. With invalidate_attempts, past attempts
 * are excluded from scored aggregates by an audited repair. XP is activity and stays.
 */
export async function retireQuestion(actor: Actor, questionVersionId: string, input: { note: string; invalidate_attempts: boolean }) {
  const q = await QuestionVersion.findById(questionVersionId);
  if (!q) throw notFound('Question');
  if (q.status === 'retired' && !input.invalidate_attempts) return questionDetail(questionVersionId);
  q.status = 'retired';
  q.retiredAt = q.retiredAt ?? new Date();
  await q.save();
  let repaired = 0;
  if (input.invalidate_attempts) {
    const affected = await Attempt.find({ questionVersionId, invalidatedAt: null }).select({ enrollmentId: 1, objectiveId: 1 }).lean();
    await Attempt.updateMany({ questionVersionId, invalidatedAt: null }, { $set: { invalidatedAt: new Date() } });
    const pairs = new Map(affected.map((a) => [`${a.enrollmentId}|${a.objectiveId}`, a]));
    for (const a of pairs.values()) await recomputeObjectiveProgress(a.enrollmentId, a.objectiveId);
    repaired = pairs.size;
    await audit(actor, 'question_version', q._id, 'attempts_invalidated', input.note, { attempts: affected.length, enrollments_repaired: repaired });
  }
  await audit(actor, 'question_version', q._id, 'retired', input.note);
  return { ...(await questionDetail(questionVersionId)), repaired_enrollments: repaired };
}

export function assertStaff(actor: Actor) {
  if (!actor.roles.includes('reviewer') && !actor.roles.includes('admin')) throw new HttpError(403, 'insufficient_role', 'Staff only');
}
