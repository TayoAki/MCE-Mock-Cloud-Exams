import { ContentAudit, Domain, Objective, QuestionFamily, QuestionKey, QuestionVersion } from '../../models/index.js';
import { REVIEW_NOTE } from '../bank.js';
import blueprintJson from './blueprint.json' with { type: 'json' };
import cicd from './cicd.json' with { type: 'json' };
import governance1 from './governance-1.json' with { type: 'json' };
import governance2 from './governance-2.json' with { type: 'json' };
import ingestion1 from './ingestion-1.json' with { type: 'json' };
import ingestion2 from './ingestion-2.json' with { type: 'json' };
import jobs1 from './jobs-1.json' with { type: 'json' };
import jobs2 from './jobs-2.json' with { type: 'json' };
import platform from './platform.json' with { type: 'json' };
import transformation1 from './transformation-1.json' with { type: 'json' };
import transformation2 from './transformation-2.json' with { type: 'json' };
import troubleshooting from './troubleshooting.json' with { type: 'json' };
import { arrangeItem, composeRationale, type Item, type ItemFile } from './schema.js';

/**
 * The question bank built by the question factory (api/question-factory):
 * items mapped to the official exam guide's objectives, grounded in the
 * documentation, and written to AUTHORING.md. Like the rest of the pilot bank
 * they are drafts without independent subject-matter review.
 */
export const QUESTION_FILES: Record<string, ItemFile> = {
  platform,
  'ingestion-1': ingestion1,
  'ingestion-2': ingestion2,
  'transformation-1': transformation1,
  'transformation-2': transformation2,
  'jobs-1': jobs1,
  'jobs-2': jobs2,
  cicd,
  troubleshooting,
  'governance-1': governance1,
  'governance-2': governance2,
} as Record<string, ItemFile>;

export const BLUEPRINT = blueprintJson as {
  objectives: { code: string; domain: string; title: string; guide: string[]; new: number; file: string }[];
};

/** Seed titles that the current exam guide renamed. Only an untouched seed title is updated, so staff edits stay. */
const RENAMED_OBJECTIVES: Record<string, string> = {
  'platform.lakehouse': 'Lakehouse and Delta Lake fundamentals',
  'jobs.orchestration': 'Tasks, dependencies and triggers',
  'jobs.recovery': 'Retries and repair runs',
  'cicd.bundles': 'Databricks Asset Bundles',
  'troubleshooting.layout': 'Data layout: OPTIMIZE, Z-order and liquid clustering',
  'troubleshooting.spark-ui': 'Diagnosing slow queries',
};
const RENAMED_DOMAINS: Record<string, [string, string]> = {
  troubleshooting: ['Troubleshooting and optimization', 'Troubleshooting, monitoring and optimization'],
};

export const bankItems = (): Item[] => Object.values(QUESTION_FILES).flatMap((f) => f.items);

/** Creates the guide's objectives that are missing and refreshes renamed seed titles. */
async function ensureObjectives(examVersionId: string) {
  const domains = new Map((await Domain.find({ examVersionId }).lean()).map((d) => [d.code, d]));
  for (const [code, [from, to]] of Object.entries(RENAMED_DOMAINS)) {
    await Domain.updateOne({ examVersionId, code, title: from }, { $set: { title: to } });
  }
  for (const o of BLUEPRINT.objectives) {
    const existing = await Objective.findOne({ examVersionId, code: o.code }).lean();
    if (existing) {
      if (existing.title !== o.title && RENAMED_OBJECTIVES[o.code] === existing.title) await Objective.updateOne({ _id: existing._id }, { $set: { title: o.title } });
      continue;
    }
    const domain = domains.get(o.domain);
    if (!domain) throw new Error(`Unknown domain ${o.domain} for objective ${o.code}`);
    const last = await Objective.findOne({ examVersionId, domainId: domain._id }).sort({ sortOrder: -1 }).lean();
    await Objective.create({ examVersionId, domainId: domain._id, code: o.code, title: o.title, sortOrder: (last?.sortOrder ?? 0) + 1 });
  }
}

const words = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Brings an untouched factory explanation up to the current layout (paragraph
 * breaks). Only whitespace may differ, so a reviewer's edits are never overwritten.
 */
async function refreshLayout(familyId: string, rationale: string) {
  const versions = await QuestionVersion.find({ familyId }).select({ _id: 1 }).lean();
  const keys = await QuestionKey.find({ _id: { $in: versions.map((v) => v._id) } }).select({ rationale: 1 }).lean();
  for (const key of keys) {
    if (key.rationale !== rationale && words(key.rationale) === words(rationale)) await QuestionKey.updateOne({ _id: key._id }, { $set: { rationale } });
  }
}

/**
 * Adds the factory's questions. Additive and idempotent by family key, so an
 * existing database picks up new items on the next start without changing
 * anything already there (published questions are revised through the backoffice).
 */
export async function addQuestionBank(examVersionId: string, opts: { publish: boolean; reviewerId: string; now?: Date }) {
  const now = opts.now ?? new Date();
  await ensureObjectives(examVersionId);
  const objectives = new Map((await Objective.find({ examVersionId }).lean()).map((o) => [o.code, o]));
  const existing = new Map((await QuestionFamily.find({ examVersionId }).select({ familyKey: 1, createdBy: 1 }).lean()).map((f) => [f.familyKey, f]));
  let added = 0;
  for (const item of bankItems()) {
    const family = existing.get(item.family);
    if (family) {
      if (family.createdBy === opts.reviewerId) await refreshLayout(family._id, composeRationale(item));
      continue;
    }
    const objective = objectives.get(item.objective);
    if (!objective) throw new Error(`Unknown objective ${item.objective}`);
    const created = await QuestionFamily.create({
      examVersionId,
      objectiveId: objective._id,
      familyKey: item.family,
      difficulty: item.difficulty,
      createdBy: opts.reviewerId,
    });
    const { options, correct } = arrangeItem(item);
    const qv = await QuestionVersion.create({
      familyId: created._id,
      examVersionId,
      objectiveId: objective._id,
      domainId: objective.domainId,
      revision: 1,
      prompt: item.stem,
      answerType: item.type,
      options,
      sourceUrl: item.source,
      createdBy: opts.reviewerId,
      ...(opts.publish ? { status: 'published', reviewedBy: opts.reviewerId, reviewedAt: now, publishedAt: now } : {}),
    });
    await QuestionKey.create({
      _id: qv._id,
      correctOptions: correct,
      rationale: composeRationale(item),
      reviewedNotes: `${REVIEW_NOTE} Guide ${item.guide}. Evidence: ${item.evidence}`,
    });
    await ContentAudit.create({
      actorId: opts.reviewerId,
      entityType: 'question_version',
      entityId: qv._id,
      action: opts.publish ? 'published' : 'created',
      note: opts.publish ? 'Question factory item: marked reviewed to exercise delivery. Not subject-matter approval.' : 'Question factory draft',
    });
    added++;
  }
  return { added };
}
