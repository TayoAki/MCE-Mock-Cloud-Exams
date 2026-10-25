import { config } from '../config.js';
import {
  ContentAudit,
  Domain,
  Enrollment,
  Exam,
  ExamVersion,
  Lesson,
  NotificationPreference,
  Objective,
  QuestionFamily,
  QuestionKey,
  QuestionVersion,
  StreakState,
  Unit,
  User,
} from '../models/index.js';
import { hashPassword } from '../auth/passwords.js';
import type { Role } from '../models/index.js';
import { uuid } from '../lib/ids.js';
import { DOMAINS, REVIEW_NOTE, UNITS, type SeedQuestion } from './bank.js';

const PILOT_SLUG = 'databricks-de-associate';
/** The plan's five original sample items keep their published option order (A, B, B, A, D scores 3/5). */
const PLAN_SAMPLE_FAMILIES = new Set(['retained-files', 'history-versus-data', 'vacuum-purpose', 'version-query', 'retention-settings']);

/**
 * Authored drafts list the correct answer first. Shuffle options with a seed
 * derived from the family key so keys spread across A–D but stay stable across seeds.
 */
function arrange(item: SeedQuestion) {
  const correct = new Set(Array.isArray(item.correct) ? item.correct : [item.correct]);
  const tagged = item.options.map((text, i) => ({ text, correct: correct.has(String.fromCharCode(65 + i)) }));
  if (!PLAN_SAMPLE_FAMILIES.has(item.family)) {
    let seed = [...item.family].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
    const next = () => (seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) / 4294967296;
    for (let i = tagged.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [tagged[i], tagged[j]] = [tagged[j]!, tagged[i]!];
    }
  }
  return {
    options: tagged.map((t, k) => ({ key: String.fromCharCode(65 + k), text: t.text })),
    correct: tagged.flatMap((t, k) => (t.correct ? [String.fromCharCode(65 + k)] : [])),
  };
}
export const FIXTURE_REVIEWER_ID = '00000000-0000-4000-8000-00000000f1f0';

export interface SeedOptions {
  /** Publish the version, questions and lessons (a dev fixture, not content approval). */
  publish?: boolean;
  /** Create the admin and demo learner accounts. */
  accounts?: boolean;
  /** With accounts, also create the demo learner (default true). */
  demoLearner?: boolean;
}

async function ensureUser(input: { email: string; password: string; displayName: string; roles: Role[]; timezone: string }) {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) return existing._id;
  const id = uuid();
  await User.create({
    _id: id,
    externalSubject: `local:${id}`,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    isGuest: false,
    roles: input.roles,
    displayName: input.displayName,
    timezone: input.timezone,
  });
  return id;
}

export async function seedDatabase(options: SeedOptions = {}) {
  const publish = options.publish ?? true;
  const now = new Date();

  await User.updateOne(
    { _id: FIXTURE_REVIEWER_ID },
    {
      $setOnInsert: {
        externalSubject: 'system:content-fixture',
        isGuest: false,
        roles: ['reviewer'],
        displayName: 'Content fixture (not a human review)',
        timezone: 'Etc/UTC',
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const existingExam = await Exam.findOne({ slug: PILOT_SLUG }).lean();
  let examId: string;
  let examVersionId: string;
  if (existingExam) {
    examId = existingExam._id;
    examVersionId = (await ExamVersion.findOne({ examId }).sort({ effectiveFrom: -1 }).lean())!._id;
  } else {
    const created = await Exam.create({
      slug: PILOT_SLUG,
      provider: 'databricks',
      title: 'Databricks',
      subtitle: 'Data Engineer Associate',
      status: 'pilot',
      canonicalUrl: 'https://www.databricks.com/learn/certification/data-engineer-associate',
      sortOrder: 1,
    });
    examId = created._id;
    await Exam.create([
      { slug: 'aws-planned', provider: 'aws', title: 'AWS', subtitle: 'Certification paths', status: 'planned', canonicalUrl: 'https://aws.amazon.com/certification/', sortOrder: 2 },
      { slug: 'fabric-planned', provider: 'microsoft', title: 'Microsoft Fabric', subtitle: 'Certification paths', status: 'planned', canonicalUrl: 'https://learn.microsoft.com/credentials/', sortOrder: 3 },
    ]);

    const version = await ExamVersion.create({
      examId: created._id,
      // Snapshot import date; not an official guide edition date.
      versionLabel: 'reference-snapshot-2026-10-24',
      effectiveFrom: '2026-10-24',
      questionCount: 45,
      durationMinutes: 90,
      passingNote: 'CertPath reports practice scores only and does not predict exam results.',
      guideUrl: 'https://www.databricks.com/learn/certification/data-engineer-associate',
    });
    examVersionId = version._id;

    const objectiveIds = new Map<string, { id: string; domainId: string }>();
    for (const [i, d] of DOMAINS.entries()) {
      const domain = await Domain.create({ examVersionId, code: d.code, title: d.title, weightPercent: d.weight, sortOrder: i + 1 });
      for (const [j, o] of d.objectives.entries()) {
        const objective = await Objective.create({ examVersionId, domainId: domain._id, code: o.code, title: o.title, sortOrder: j + 1 });
        objectiveIds.set(o.code, { id: objective._id, domainId: domain._id });
      }
    }

    for (const [u, unitSeed] of UNITS.entries()) {
      const unit = await Unit.create({ examVersionId, title: unitSeed.title, subtitle: unitSeed.subtitle, sortOrder: u + 1 });
      for (const [l, lessonSeed] of unitSeed.lessons.entries()) {
        const familyIds: string[] = [];
        const lessonObjectives = new Set<string>();
        for (const item of lessonSeed.questions) {
          const objective = objectiveIds.get(item.objective);
          if (!objective) throw new Error(`Unknown objective ${item.objective}`);
          lessonObjectives.add(objective.id);
          const family = await QuestionFamily.create({ examVersionId, objectiveId: objective.id, familyKey: item.family, createdBy: FIXTURE_REVIEWER_ID });
          const { options, correct } = arrange(item);
          const qv = await QuestionVersion.create({
            familyId: family._id,
            examVersionId,
            objectiveId: objective.id,
            domainId: objective.domainId,
            revision: 1,
            prompt: item.prompt,
            answerType: correct.length > 1 ? 'multiple' : 'single',
            options,
            sourceUrl: item.source,
            createdBy: FIXTURE_REVIEWER_ID,
            ...(publish ? { status: 'published', reviewedBy: FIXTURE_REVIEWER_ID, reviewedAt: now, publishedAt: now } : {}),
          });
          await QuestionKey.create({ _id: qv._id, correctOptions: correct, rationale: item.rationale, reviewedNotes: REVIEW_NOTE });
          await ContentAudit.create({
            actorId: FIXTURE_REVIEWER_ID,
            entityType: 'question_version',
            entityId: qv._id,
            action: publish ? 'published' : 'created',
            note: publish ? 'Seed fixture: marked reviewed to exercise delivery. Not subject-matter approval.' : 'Seed draft',
          });
          familyIds.push(family._id);
        }
        await Lesson.create({
          examVersionId,
          unitId: unit._id,
          title: lessonSeed.title,
          summary: lessonSeed.summary,
          kind: lessonSeed.kind ?? 'learn',
          questionCount: 5,
          sortOrder: l + 1,
          status: publish ? 'published' : 'draft',
          objectiveIds: [...lessonObjectives],
          poolFamilyIds: familyIds,
        });
      }
    }
    if (publish) {
      await ExamVersion.updateOne({ _id: examVersionId }, { $set: { status: 'published', publishedAt: now, publishedBy: FIXTURE_REVIEWER_ID } });
    }
  }

  const result: { examVersionId: string; adminId?: string; demoUserId?: string } = { examVersionId };
  if (options.accounts) {
    result.adminId = await ensureUser({
      email: config.SEED_ADMIN_EMAIL,
      password: config.SEED_ADMIN_PASSWORD,
      displayName: 'Content admin',
      roles: ['admin', 'reviewer'],
      timezone: 'Etc/UTC',
    });
  }
  if (options.accounts && (options.demoLearner ?? true)) {
    result.demoUserId = await ensureUser({
      email: config.SEED_DEMO_EMAIL,
      password: config.SEED_DEMO_PASSWORD,
      displayName: 'Alex',
      roles: ['learner'],
      timezone: 'America/New_York',
    });
    await Enrollment.updateOne(
      { userId: result.demoUserId, examVersionId },
      { $setOnInsert: { _id: uuid(), examId, status: 'active', startedAt: now, examDate: null } },
      { upsert: true },
    );
    await NotificationPreference.updateOne({ _id: result.demoUserId }, { $setOnInsert: { remindersEnabled: false } }, { upsert: true });
    await StreakState.updateOne({ _id: result.demoUserId }, { $setOnInsert: { currentDays: 0, longestDays: 0 } }, { upsert: true });
  }
  return result;
}
