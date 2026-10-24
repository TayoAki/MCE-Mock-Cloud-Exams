import { Domain, Exam, ExamVersion, Lesson, Objective, QuestionVersion, Unit } from '../models/index.js';
import { notFound } from '../lib/errors.js';

export type QuestionVersionLean = Awaited<ReturnType<typeof loadQuestionVersions>>[number];

export function loadQuestionVersions(ids: string[]) {
  return QuestionVersion.find({ _id: { $in: ids } }).lean();
}

/** The newest published version of each exam, if any. */
export async function currentVersions(examIds: string[]) {
  const versions = await ExamVersion.find({ examId: { $in: examIds }, status: 'published' })
    .sort({ effectiveFrom: -1 })
    .lean();
  const byExam = new Map<string, (typeof versions)[number]>();
  for (const v of versions) if (!byExam.has(v.examId)) byExam.set(v.examId, v);
  return byExam;
}

export async function listCatalog() {
  const exams = await Exam.find().sort({ sortOrder: 1, title: 1 }).lean();
  const versions = await currentVersions(exams.map((e) => e._id));
  return exams.map((e) => {
    const v = versions.get(e._id);
    const enrollable = (e.status === 'pilot' || e.status === 'active') && !!v;
    return {
      id: e._id,
      slug: e.slug,
      title: e.title,
      subtitle: e.subtitle,
      provider: e.provider,
      status: e.status,
      enrollable,
      current_version_id: v?._id ?? null,
      current_version: v
        ? {
            id: v._id,
            version_label: v.versionLabel,
            question_count: v.questionCount,
            duration_minutes: v.durationMinutes,
            guide_url: v.guideUrl,
          }
        : null,
    };
  });
}

export async function loadBlueprint(examVersionId: string) {
  const version = await ExamVersion.findById(examVersionId).lean();
  if (!version) throw notFound('Exam version');
  const [exam, domains, objectives] = await Promise.all([
    Exam.findById(version.examId).lean(),
    Domain.find({ examVersionId }).sort({ sortOrder: 1 }).lean(),
    Objective.find({ examVersionId }).sort({ sortOrder: 1, code: 1 }).lean(),
  ]);
  if (!exam) throw notFound('Exam');
  return { exam, version, domains, objectives };
}

/** Published lessons in path order: unit order, then lesson order. */
export async function orderedLessons(examVersionId: string) {
  const [units, lessons] = await Promise.all([
    Unit.find({ examVersionId }).sort({ sortOrder: 1 }).lean(),
    Lesson.find({ examVersionId, status: 'published' }).lean(),
  ]);
  const unitOrder = new Map(units.map((u, i) => [u._id, i]));
  const ordered = lessons
    .filter((l) => unitOrder.has(l.unitId))
    .sort((a, b) => unitOrder.get(a.unitId)! - unitOrder.get(b.unitId)! || a.sortOrder - b.sortOrder);
  return { units, lessons: ordered };
}

/** Latest published revision per family (new sessions never get retired revisions). */
export async function latestPublishedByFamily(examVersionId: string, familyIds?: string[]) {
  const filter: Record<string, unknown> = { examVersionId, status: 'published' };
  if (familyIds) filter.familyId = { $in: familyIds };
  const rows = await QuestionVersion.find(filter).sort({ revision: -1 }).lean();
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.familyId)) map.set(r.familyId, r);
  return map;
}
