import { ContentAudit, Lesson, Objective, QuestionFamily, QuestionKey, QuestionVersion, Story, Unit } from '../models/index.js';
import { keyMatchPairs, keyOrderSteps, seededRandom } from '../lib/answers.js';
import { REVIEW_NOTE } from './bank.js';

/**
 * Development content for the newer question formats (order, match, typed and
 * spoken answers, listening) and two stories. Like the rest of the pilot bank,
 * these are original drafts without independent subject-matter review.
 *
 * `addFormatContent` is additive and idempotent: it creates whatever is
 * missing by family key, unit and lesson title, or story slug, so an existing
 * database picks this up on the next start without changing anything else.
 */

const DOCS = 'https://docs.databricks.com/aws/en';
const SRC = {
  vacuum: 'https://learn.microsoft.com/en-us/azure/databricks/sql/language-manual/delta-vacuum',
  history: 'https://learn.microsoft.com/en-us/azure/databricks/tables/history',
  restore: `${DOCS}/sql/language-manual/delta-restore`,
  merge: `${DOCS}/sql/language-manual/delta-merge-into`,
  optimize: `${DOCS}/sql/language-manual/delta-optimize`,
  medallion: `${DOCS}/lakehouse/medallion`,
  autoLoader: `${DOCS}/ingestion/cloud-object-storage/auto-loader/`,
  autoLoaderSchema: `${DOCS}/ingestion/cloud-object-storage/auto-loader/schema`,
  copyInto: `${DOCS}/sql/language-manual/delta-copy-into`,
  expectations: `${DOCS}/dlt/expectations`,
  delta: `${DOCS}/delta/`,
  bundles: `${DOCS}/dev-tools/bundles/`,
  unityCatalog: `${DOCS}/data-governance/unity-catalog/`,
};

interface Base {
  family: string;
  objective: string;
  prompt: string;
  rationale: string;
  source: string;
  /** Read the prompt aloud first. */
  listen?: boolean;
}
export type FormatSeed =
  | (Base & { kind: 'single'; options: string[]; correct: number })
  | (Base & { kind: 'order'; steps: string[] })
  | (Base & { kind: 'match'; pairs: [string, string][] })
  | (Base & { kind: 'type'; accepted: string[]; hint: string });

export const HANDS_ON_UNIT = {
  title: 'Hands-on',
  subtitle: 'Commands in action',
  lessons: [
    {
      title: 'Commands in action',
      summary: 'Match, order and type the commands you use most.',
      questions: [
        {
          kind: 'match',
          family: 'match-delta-commands',
          objective: 'transformation.cleanup',
          prompt: 'Match each Delta Lake command to what it does.',
          pairs: [
            ['VACUUM', 'Deletes unreferenced data files past the retention threshold'],
            ['OPTIMIZE', 'Compacts small files into larger ones'],
            ['RESTORE', 'Rolls the table back to an earlier version'],
            ['DESCRIBE HISTORY', "Lists the table's commits and operations"],
          ],
          rationale: 'VACUUM cleans up files, OPTIMIZE improves layout, RESTORE writes a commit that matches an older version, and DESCRIBE HISTORY reads the log.',
          source: SRC.optimize,
        },
        {
          kind: 'type',
          family: 'type-vacuum',
          objective: 'transformation.cleanup',
          prompt: 'Which command removes data files that a Delta table no longer references?',
          accepted: ['VACUUM'],
          hint: 'Type the command',
          rationale: 'VACUUM deletes files no longer referenced by the table once they are older than the retention threshold (7 days by default).',
          source: SRC.vacuum,
        },
        {
          kind: 'order',
          family: 'order-restore-steps',
          objective: 'transformation.time-travel',
          prompt: 'A bad write corrupted the orders table. Put the recovery steps in order.',
          steps: ['Run DESCRIBE HISTORY orders', 'Find the last good version', 'Run RESTORE TABLE orders TO VERSION AS OF that version', 'Query the table to confirm the fix'],
          rationale: 'History tells you which version to go back to. RESTORE then writes a new commit matching it, and a check confirms the result.',
          source: SRC.restore,
        },
        {
          kind: 'type',
          family: 'type-version-as-of',
          objective: 'transformation.time-travel',
          prompt: 'Complete the query that reads version 12 of sales: SELECT * FROM sales ____ 12',
          accepted: ['VERSION AS OF'],
          hint: 'Type the missing words',
          rationale: 'VERSION AS OF reads a historical version of a Delta table, as long as its files are still retained.',
          source: SRC.history,
        },
        {
          kind: 'single',
          family: 'listen-merge-duplicates',
          objective: 'transformation.merge',
          listen: true,
          prompt: 'A nightly MERGE started failing after the source began sending the same customer twice. What should you change first?',
          options: ['Deduplicate the source on the merge key', 'Run OPTIMIZE on the target', 'Use a bigger cluster', 'Switch to INSERT INTO'],
          correct: 0,
          rationale: 'MERGE fails when several source rows match one target row. Deduplicating the source on the key fixes the cause.',
          source: SRC.merge,
        },
      ] satisfies FormatSeed[],
    },
    {
      title: 'Build the pipeline',
      summary: 'Layers, loaders and where things live.',
      questions: [
        {
          kind: 'order',
          family: 'order-medallion',
          objective: 'transformation.medallion',
          prompt: 'Order the medallion layers from raw data to the most refined.',
          steps: ['Bronze: raw data as ingested', 'Silver: cleaned and conformed', 'Gold: business-level aggregates'],
          rationale: 'Data moves from bronze (raw) through silver (validated and joined) to gold (ready for reporting).',
          source: SRC.medallion,
        },
        {
          kind: 'match',
          family: 'match-ingestion-tools',
          objective: 'ingestion.auto-loader',
          prompt: 'Match each tool to the job it fits best.',
          pairs: [
            ['Auto Loader', 'Process new files incrementally as they land'],
            ['COPY INTO', 'Retry-safe batch loads that skip files already loaded'],
            ['Expectations', 'Drop or flag rows that fail data quality rules'],
          ],
          rationale: 'Auto Loader streams new files, COPY INTO loads batches idempotently, and expectations enforce quality rules in pipelines.',
          source: SRC.autoLoader,
        },
        {
          kind: 'type',
          family: 'type-delta-log',
          objective: 'platform.lakehouse',
          prompt: 'What is the folder called where Delta Lake keeps its transaction log?',
          accepted: ['_delta_log', 'delta log', 'delta_log'],
          hint: 'Type the folder name',
          rationale: 'Each Delta table keeps ordered JSON commits and checkpoints in its _delta_log folder.',
          source: SRC.delta,
        },
        {
          kind: 'type',
          family: 'listen-bundle-file',
          objective: 'cicd.bundles',
          listen: true,
          prompt: 'Which file at the root of a project defines a Databricks Asset Bundle?',
          accepted: ['databricks.yml', 'databricks.yaml', 'databricks yml'],
          hint: 'Type or say the file name',
          rationale: 'databricks.yml holds the bundle name, resources and per-target settings.',
          source: SRC.bundles,
        },
        {
          kind: 'order',
          family: 'order-uc-namespace',
          objective: 'governance.namespace',
          prompt: "Order Unity Catalog's three-level namespace from the top level down.",
          steps: ['Catalog', 'Schema', 'Table'],
          rationale: 'Unity Catalog names objects as catalog.schema.table.',
          source: SRC.unityCatalog,
        },
      ] satisfies FormatSeed[],
    },
  ],
};

type StorySeedPart = { line: string; speaker?: string } | { question: FormatSeed };
export interface StorySeed {
  slug: string;
  title: string;
  summary: string;
  characters: { name: string; role: string }[];
  parts: StorySeedPart[];
}

export const STORIES: StorySeed[] = [
  {
    slug: 'vanishing-snapshot',
    title: 'The doubled revenue',
    summary: 'A 3 a.m. write breaks the finance dashboard. Help Priya find it and fix it.',
    characters: [
      { name: 'Priya', role: 'Data engineer' },
      { name: 'Marco', role: 'Analytics lead' },
    ],
    parts: [
      { speaker: 'Marco', line: 'Priya, the finance dashboard looks wrong this morning. Revenue doubled overnight.' },
      { speaker: 'Priya', line: "Let me look at the sales table's history. Something wrote to it at 3 a.m." },
      {
        question: {
          kind: 'type',
          family: 'story-history-command',
          objective: 'transformation.time-travel',
          prompt: 'Which command shows Priya every commit to the sales table, with its version and timestamp?',
          accepted: ['DESCRIBE HISTORY', 'DESCRIBE HISTORY sales'],
          hint: 'Type the command',
          rationale: 'DESCRIBE HISTORY returns one row per commit, including the version, timestamp and operation.',
          source: SRC.history,
        },
      },
      { speaker: 'Priya', line: 'There it is. Version 42 loaded the same file twice. Version 41 looks right.' },
      { speaker: 'Marco', line: "Can I read yesterday's numbers while you fix it?" },
      {
        question: {
          kind: 'single',
          family: 'story-read-version',
          objective: 'transformation.time-travel',
          prompt: 'Which query lets Marco read version 41 without changing the table?',
          options: ['SELECT * FROM sales VERSION AS OF 41', 'RESTORE TABLE sales TO VERSION AS OF 41', 'VACUUM sales RETAIN 41 HOURS', 'DESCRIBE DETAIL sales'],
          correct: 0,
          rationale: 'VERSION AS OF only reads an old version. RESTORE would change the table itself.',
          source: SRC.history,
        },
      },
      { speaker: 'Priya', line: "Now let's put the table itself back." },
      {
        question: {
          kind: 'order',
          family: 'story-restore-plan',
          objective: 'transformation.time-travel',
          prompt: "Put Priya's fix in order.",
          steps: ['Confirm version 41 has the right totals', 'RESTORE TABLE sales TO VERSION AS OF 41', 'Re-run the dashboard query', 'Tell the team what changed'],
          rationale: 'Check the target version first, restore, verify the result, then communicate.',
          source: SRC.restore,
        },
      },
      { speaker: 'Marco', line: 'Numbers are back. Thanks! Ops wants to run VACUUM with RETAIN 0 HOURS tonight to save space.' },
      {
        question: {
          kind: 'single',
          family: 'story-vacuum-risk',
          objective: 'transformation.cleanup',
          prompt: 'What should Priya tell ops about VACUUM with RETAIN 0 HOURS?',
          options: [
            'It deletes files older versions and running readers may still need',
            'It only removes the transaction log',
            'It speeds up every query with no downside',
            'It is required after every RESTORE',
          ],
          correct: 0,
          rationale: 'A very short retention removes files that time travel, long queries and streams can still need, which is why Databricks blocks it by default.',
          source: SRC.vacuum,
        },
      },
      { speaker: 'Priya', line: "Let's keep the default seven days. Crisis over." },
    ],
  },
  {
    slug: 'late-arriving-files',
    title: 'Files that keep coming',
    summary: 'Partners drop JSON files all day. Help Lee build an ingestion that keeps up.',
    characters: [
      { name: 'Sam', role: 'Platform engineer' },
      { name: 'Lee', role: 'Data engineer' },
    ],
    parts: [
      { speaker: 'Sam', line: 'Partners drop JSON files into our bucket all day. Right now a job re-reads the whole folder every hour.' },
      { speaker: 'Lee', line: "That's slow, and it double-counts. We only want the new files each time." },
      {
        question: {
          kind: 'single',
          family: 'story-auto-loader',
          objective: 'ingestion.auto-loader',
          prompt: 'Which feature should Lee use to pick up only new files, incrementally?',
          options: ['Auto Loader (cloudFiles)', 'VACUUM', 'OPTIMIZE', 'DESCRIBE HISTORY'],
          correct: 0,
          rationale: 'Auto Loader tracks which files it has processed and ingests only new ones as they arrive.',
          source: SRC.autoLoader,
        },
      },
      { speaker: 'Sam', line: 'A partner just added a new field, discount_code. Will that break things?' },
      {
        question: {
          kind: 'single',
          family: 'story-schema-evolution',
          objective: 'ingestion.auto-loader',
          prompt: "With Auto Loader's default schema evolution, what happens when a new column appears?",
          options: [
            'The stream stops, adds the column to the schema, and picks it up when restarted',
            'The column is silently dropped forever',
            'Every old file is processed again',
            'The table is converted to Parquet',
          ],
          correct: 0,
          rationale: 'In the default addNewColumns mode, Auto Loader fails the stream, records the new column in its schema, and includes it after a restart.',
          source: SRC.autoLoaderSchema,
        },
      },
      { speaker: 'Lee', line: 'And bad rows? Some files have negative amounts.' },
      {
        question: {
          kind: 'match',
          family: 'story-expectation-actions',
          objective: 'transformation.medallion',
          prompt: 'Match each expectation setting to what it does with a bad row.',
          pairs: [
            ['EXPECT with no action', 'Keeps the row and records the violation'],
            ['ON VIOLATION DROP ROW', 'Removes the row and carries on'],
            ['ON VIOLATION FAIL UPDATE', 'Stops the update'],
          ],
          rationale: 'Expectations can warn (keep and record), drop invalid rows, or fail the update.',
          source: SRC.expectations,
        },
      },
      { speaker: 'Sam', line: 'Last thing. Which layer do these raw files land in?' },
      {
        question: {
          kind: 'type',
          family: 'story-bronze-layer',
          objective: 'transformation.medallion',
          prompt: 'In the medallion architecture, which layer holds raw ingested data?',
          accepted: ['bronze', 'bronze layer'],
          hint: 'Type the layer',
          rationale: 'Raw data lands in bronze. Silver cleans and conforms it; gold serves business-level views.',
          source: SRC.medallion,
        },
      },
      { speaker: 'Lee', line: 'Bronze it is. Silver and gold come next sprint.' },
    ],
  },
];

/** The stored form of a seed question; order and match keys are scrambled with a seed from the family key. */
export function materialize(seed: FormatSeed) {
  const rng = seededRandom(seed.family);
  const presentation = seed.listen ? ('listen' as const) : ('text' as const);
  switch (seed.kind) {
    case 'single': {
      // Spread the correct letter across A–D, stably per family.
      const order = seed.options.map((text, i) => ({ text, correct: i === seed.correct, r: rng() })).sort((a, b) => a.r - b.r);
      const options = order.map((o, i) => ({ key: String.fromCharCode(65 + i), text: o.text }));
      return { answerType: 'single' as const, options, matchTargets: [], correctOptions: [options[order.findIndex((o) => o.correct)]!.key], acceptedAnswers: [], presentation, inputHint: null };
    }
    case 'order': {
      const keyed = keyOrderSteps(seed.steps, rng);
      return { answerType: 'order' as const, options: keyed.options, matchTargets: [], correctOptions: keyed.correct, acceptedAnswers: [], presentation, inputHint: null };
    }
    case 'match': {
      const keyed = keyMatchPairs(seed.pairs.map(([left, right]) => ({ left, right })), rng);
      return { answerType: 'match' as const, options: keyed.options, matchTargets: keyed.targets, correctOptions: keyed.correct, acceptedAnswers: [], presentation, inputHint: null };
    }
    case 'type':
      return { answerType: 'type' as const, options: [], matchTargets: [], correctOptions: [], acceptedAnswers: seed.accepted, presentation, inputHint: seed.hint };
  }
}

async function ensureQuestion(examVersionId: string, seed: FormatSeed, ctx: { publish: boolean; reviewerId: string; now: Date; storyId?: string }) {
  const existing = await QuestionFamily.findOne({ examVersionId, familyKey: seed.family }).lean();
  if (existing) return existing._id;
  const objective = await Objective.findOne({ examVersionId, code: seed.objective }).lean();
  if (!objective) throw new Error(`Unknown objective ${seed.objective}`);
  const family = await QuestionFamily.create({ examVersionId, objectiveId: objective._id, familyKey: seed.family, createdBy: ctx.reviewerId });
  const { correctOptions, acceptedAnswers, ...shape } = materialize(seed);
  const qv = await QuestionVersion.create({
    familyId: family._id,
    examVersionId,
    objectiveId: objective._id,
    domainId: objective.domainId,
    revision: 1,
    prompt: seed.prompt,
    ...shape,
    storyId: ctx.storyId ?? null,
    sourceUrl: seed.source,
    createdBy: ctx.reviewerId,
    ...(ctx.publish ? { status: 'published', reviewedBy: ctx.reviewerId, reviewedAt: ctx.now, publishedAt: ctx.now } : {}),
  });
  await QuestionKey.create({ _id: qv._id, correctOptions, acceptedAnswers, rationale: seed.rationale, reviewedNotes: REVIEW_NOTE });
  await ContentAudit.create({
    actorId: ctx.reviewerId,
    entityType: 'question_version',
    entityId: qv._id,
    action: ctx.publish ? 'published' : 'created',
    note: ctx.publish ? 'Seed fixture: marked reviewed to exercise delivery. Not subject-matter approval.' : 'Seed draft',
  });
  return family._id;
}

export async function addFormatContent(examVersionId: string, opts: { publish: boolean; reviewerId: string; now?: Date }) {
  const ctx = { publish: opts.publish, reviewerId: opts.reviewerId, now: opts.now ?? new Date() };
  const status = opts.publish ? 'published' : 'draft';

  let unitId = (await Unit.findOne({ examVersionId, title: HANDS_ON_UNIT.title }).lean())?._id;
  if (!unitId) {
    const last = await Unit.findOne({ examVersionId }).sort({ sortOrder: -1 }).lean();
    unitId = (await Unit.create({ examVersionId, title: HANDS_ON_UNIT.title, subtitle: HANDS_ON_UNIT.subtitle, sortOrder: (last?.sortOrder ?? 0) + 1 }))._id;
  }
  for (const [i, lesson] of HANDS_ON_UNIT.lessons.entries()) {
    if (await Lesson.exists({ examVersionId, unitId, title: lesson.title })) continue;
    const familyIds: string[] = [];
    for (const q of lesson.questions) familyIds.push(await ensureQuestion(examVersionId, q, ctx));
    const objectiveIds = (await QuestionFamily.find({ _id: { $in: familyIds } }).select({ objectiveId: 1 }).lean()).map((f) => f.objectiveId);
    await Lesson.create({
      examVersionId,
      unitId,
      title: lesson.title,
      summary: lesson.summary,
      kind: 'learn',
      questionCount: lesson.questions.length,
      sortOrder: i + 1,
      status,
      objectiveIds: [...new Set(objectiveIds)],
      poolFamilyIds: familyIds,
    });
  }

  for (const [i, seed] of STORIES.entries()) {
    if (await Story.exists({ examVersionId, slug: seed.slug })) continue;
    const story = await Story.create({ examVersionId, slug: seed.slug, title: seed.title, summary: seed.summary, characters: seed.characters, sortOrder: i + 1, status });
    const parts = [];
    for (const part of seed.parts) {
      if ('line' in part) parts.push({ kind: 'line', speaker: part.speaker ?? null, text: part.line });
      else parts.push({ kind: 'question', familyId: await ensureQuestion(examVersionId, part.question, { ...ctx, storyId: story._id }) });
    }
    story.set('parts', parts);
    await story.save();
  }
}
