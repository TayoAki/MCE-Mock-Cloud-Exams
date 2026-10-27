import { ContentAudit, Domain, Objective, QuestionFamily, QuestionKey, QuestionVersion } from '../../models/index.js';
import { REVIEW_NOTE } from '../bank.js';
import blueprintJson from './blueprint.json' with { type: 'json' };
import cicd from './cicd.json' with { type: 'json' };
import cicd2 from './cicd-2.json' with { type: 'json' };
import governance1 from './governance-1.json' with { type: 'json' };
import governance2 from './governance-2.json' with { type: 'json' };
import governance3 from './governance-3.json' with { type: 'json' };
import governance4 from './governance-4.json' with { type: 'json' };
import ingestion1 from './ingestion-1.json' with { type: 'json' };
import ingestion2 from './ingestion-2.json' with { type: 'json' };
import ingestion3 from './ingestion-3.json' with { type: 'json' };
import ingestion4 from './ingestion-4.json' with { type: 'json' };
import jobs1 from './jobs-1.json' with { type: 'json' };
import jobs2 from './jobs-2.json' with { type: 'json' };
import jobs3 from './jobs-3.json' with { type: 'json' };
import jobs4 from './jobs-4.json' with { type: 'json' };
import platform from './platform.json' with { type: 'json' };
import platform2 from './platform-2.json' with { type: 'json' };
import transformation1 from './transformation-1.json' with { type: 'json' };
import transformation2 from './transformation-2.json' with { type: 'json' };
import transformation3 from './transformation-3.json' with { type: 'json' };
import transformation4 from './transformation-4.json' with { type: 'json' };
import troubleshooting from './troubleshooting.json' with { type: 'json' };
import troubleshooting2 from './troubleshooting-2.json' with { type: 'json' };
import platform3 from './platform-3.json' with { type: 'json' };
import ingestion5 from './ingestion-5.json' with { type: 'json' };
import ingestion6 from './ingestion-6.json' with { type: 'json' };
import ingestion7 from './ingestion-7.json' with { type: 'json' };
import ingestion8 from './ingestion-8.json' with { type: 'json' };
import transformation5 from './transformation-5.json' with { type: 'json' };
import transformation6 from './transformation-6.json' with { type: 'json' };
import transformation7 from './transformation-7.json' with { type: 'json' };
import transformation8 from './transformation-8.json' with { type: 'json' };
import jobs5 from './jobs-5.json' with { type: 'json' };
import jobs6 from './jobs-6.json' with { type: 'json' };
import jobs7 from './jobs-7.json' with { type: 'json' };
import cicd3 from './cicd-3.json' with { type: 'json' };
import cicd4 from './cicd-4.json' with { type: 'json' };
import troubleshooting3 from './troubleshooting-3.json' with { type: 'json' };
import troubleshooting4 from './troubleshooting-4.json' with { type: 'json' };
import governance5 from './governance-5.json' with { type: 'json' };
import governance6 from './governance-6.json' with { type: 'json' };
import governance7 from './governance-7.json' with { type: 'json' };
import governance8 from './governance-8.json' with { type: 'json' };
import { arrangeItem, composeRationale, type Item, type ItemFile } from './schema.js';
import { WITHDRAWN_FAMILIES } from './withdrawn.js';

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
  // Second batch (October 2026), taking the bank from 300 to 500.
  'platform-2': platform2,
  'ingestion-3': ingestion3,
  'ingestion-4': ingestion4,
  'transformation-3': transformation3,
  'transformation-4': transformation4,
  'jobs-3': jobs3,
  'jobs-4': jobs4,
  'cicd-2': cicd2,
  'troubleshooting-2': troubleshooting2,
  'governance-3': governance3,
  'governance-4': governance4,
  // Third batch (October 2026), taking the bank from 500 to 1,000.
  'platform-3': platform3,
  'ingestion-5': ingestion5,
  'ingestion-6': ingestion6,
  'ingestion-7': ingestion7,
  'ingestion-8': ingestion8,
  'transformation-5': transformation5,
  'transformation-6': transformation6,
  'transformation-7': transformation7,
  'transformation-8': transformation8,
  'jobs-5': jobs5,
  'jobs-6': jobs6,
  'jobs-7': jobs7,
  'cicd-3': cicd3,
  'cicd-4': cicd4,
  'troubleshooting-3': troubleshooting3,
  'troubleshooting-4': troubleshooting4,
  'governance-5': governance5,
  'governance-6': governance6,
  'governance-7': governance7,
  'governance-8': governance8,
} as Record<string, ItemFile>;

export const BLUEPRINT = blueprintJson as {
  objectives: { code: string; domain: string; title: string; guide: string[]; target: number; files: string[] }[];
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
 * The published revision of a factory family that the importer may still change:
 * every revision came from the factory (none from the backoffice) and the latest is published.
 */
async function factoryOwned(familyId: string, reviewerId: string) {
  const versions = await QuestionVersion.find({ familyId }).sort({ revision: -1 });
  if (!versions.length || versions.some((v) => v.createdBy !== reviewerId)) return null;
  return versions[0]!.status === 'published' ? versions[0]! : null;
}

/** Retires the published revision for new sessions, as the backoffice does. */
async function retireVersion(version: InstanceType<typeof QuestionVersion>, actorId: string, note: string) {
  version.status = 'retired';
  version.retiredAt = new Date();
  await version.save();
  await ContentAudit.create({ actorId, entityType: 'question_version', entityId: version._id, action: 'retired', note });
}

/**
 * Keeps an untouched factory question in step with its bank file. A changed item
 * is published as a new revision and the old one retired for new sessions, so
 * learner history stays on the revision it was answered on. Once staff revise
 * the family in the backoffice, the importer leaves it alone.
 */
async function syncItem(familyId: string, item: Item, opts: { reviewerId: string; now: Date }) {
  await refreshLayout(familyId, composeRationale(item));
  const current = await factoryOwned(familyId, opts.reviewerId);
  if (!current) return false;
  await QuestionFamily.updateOne({ _id: familyId, difficulty: { $ne: item.difficulty } }, { $set: { difficulty: item.difficulty } });
  const key = await QuestionKey.findById(current._id).lean();
  const { options, correct } = arrangeItem(item);
  const rationale = composeRationale(item);
  const same =
    current.prompt === item.stem &&
    current.answerType === item.type &&
    current.sourceUrl === item.source &&
    JSON.stringify(current.options.map((o) => [o.key, o.text])) === JSON.stringify(options.map((o) => [o.key, o.text])) &&
    JSON.stringify(key?.correctOptions ?? []) === JSON.stringify(correct) &&
    words(key?.rationale ?? '') === words(rationale);
  if (same) return false;
  const revision = await QuestionVersion.create({
    familyId,
    examVersionId: current.examVersionId,
    objectiveId: current.objectiveId,
    domainId: current.domainId,
    revision: current.revision + 1,
    prompt: item.stem,
    answerType: item.type,
    options,
    sourceUrl: item.source,
    createdBy: opts.reviewerId,
    status: 'published',
    reviewedBy: opts.reviewerId,
    reviewedAt: opts.now,
    publishedAt: opts.now,
  });
  await QuestionKey.create({ _id: revision._id, correctOptions: correct, rationale, reviewedNotes: `${REVIEW_NOTE} Guide ${item.guide}. Evidence: ${item.evidence}` });
  await ContentAudit.create({ actorId: opts.reviewerId, entityType: 'question_version', entityId: revision._id, action: 'published', note: 'Question factory item updated from its bank file.' });
  await retireVersion(current, opts.reviewerId, `Superseded by revision ${revision.revision}`);
  return true;
}

/**
 * Imports the factory's questions, idempotently by family key: new items are
 * added, changed ones get a new revision (see syncItem) and withdrawn ones are
 * retired. Questions staff have revised in the backoffice are never changed.
 */
export async function addQuestionBank(examVersionId: string, opts: { publish: boolean; reviewerId: string; now?: Date; items?: Item[] }) {
  const now = opts.now ?? new Date();
  await ensureObjectives(examVersionId);
  const objectives = new Map((await Objective.find({ examVersionId }).lean()).map((o) => [o.code, o]));
  const existing = new Map((await QuestionFamily.find({ examVersionId }).select({ familyKey: 1, createdBy: 1 }).lean()).map((f) => [f.familyKey, f]));
  let added = 0;
  let revised = 0;
  let withdrawn = 0;
  for (const [familyKey, reason] of Object.entries(WITHDRAWN_FAMILIES)) {
    const family = existing.get(familyKey);
    const current = family?.createdBy === opts.reviewerId ? await factoryOwned(family._id, opts.reviewerId) : null;
    if (current) (await retireVersion(current, opts.reviewerId, `Withdrawn from the question factory: ${reason}`), withdrawn++);
  }
  for (const item of opts.items ?? bankItems()) {
    const family = existing.get(item.family);
    if (family) {
      if (family.createdBy === opts.reviewerId && opts.publish && (await syncItem(family._id, item, { reviewerId: opts.reviewerId, now }))) revised++;
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
  return { added, revised, withdrawn };
}
