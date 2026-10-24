import {
  Attempt,
  Lesson,
  ObjectiveProgress,
  PracticeSession,
  QuestionExposure,
  ReviewQueue,
  type SessionMode,
} from '../models/index.js';
import { HttpError, badRequest, conflict, notFound, plusRequired } from '../lib/errors.js';
import { shuffle } from '../lib/ids.js';
import { MIN_RANKING_SAMPLE, SAMPLE_MOCK_SIZE, allocateBlueprint, type FeatureKey } from '../lib/rules.js';
import { localDate, startOfLocalDay } from '../lib/time.js';
import { latestPublishedByFamily, loadBlueprint, type QuestionVersionLean } from './content.js';
import { computePath } from './path.js';

export interface SelectionInput {
  mode: SessionMode;
  lessonId?: string;
  domainIds?: string[];
  questionCount?: number;
}

export interface SelectionContext {
  userId: string;
  timezone: string;
  enrollment: { _id: string; examVersionId: string };
  features: Set<FeatureKey>;
  now: Date;
}

export interface ItemSpec {
  questionVersionId: string;
  familyId: string;
  objectiveId: string;
  domainId: string;
  repeat: boolean;
}

export interface Selection {
  mode: SessionMode;
  items: ItemSpec[];
  lessonId: string | null;
  deadlineAt: Date | null;
  config: Record<string, unknown>;
}

type Exposure = { answeredCount: number; lastSeenAt: Date };

async function exposureMap(userId: string, examVersionId: string) {
  const rows = await QuestionExposure.find({ userId, examVersionId }).lean();
  return new Map<string, Exposure>(rows.map((r) => [r.familyId, { answeredCount: r.answeredCount, lastSeenAt: r.lastSeenAt }]));
}

const toItem = (q: QuestionVersionLean, exposure: Map<string, Exposure>): ItemSpec => ({
  questionVersionId: q._id,
  familyId: q.familyId,
  objectiveId: q.objectiveId,
  domainId: q.domainId,
  repeat: exposure.has(q.familyId),
});

/** Unseen families first (in random order), then the least practiced and least recent. */
function rankFresh(candidates: QuestionVersionLean[], exposure: Map<string, Exposure>) {
  const unseen = shuffle(candidates.filter((q) => !exposure.has(q.familyId)));
  const seen = candidates
    .filter((q) => exposure.has(q.familyId))
    .sort((a, b) => {
      const ea = exposure.get(a.familyId)!;
      const eb = exposure.get(b.familyId)!;
      return ea.answeredCount - eb.answeredCount || ea.lastSeenAt.getTime() - eb.lastSeenAt.getTime();
    });
  return [...unseen, ...seen];
}

/**
 * Families a learner may practise outside the path. Plus (full_bank) opens the
 * whole published bank; the free plan covers unlocked lessons and anything already seen.
 */
async function practiceScope(ctx: SelectionContext, exposure: Map<string, Exposure>) {
  const all = await latestPublishedByFamily(ctx.enrollment.examVersionId);
  if (ctx.features.has('full_bank')) return [...all.values()];
  const path = await computePath(ctx.enrollment);
  const unlocked = new Set(path.lessons.filter((l) => l.state !== 'locked').map((l) => l.id));
  const lessons = await Lesson.find({ _id: { $in: [...unlocked] } }).select({ poolFamilyIds: 1 }).lean();
  const allowed = new Set(lessons.flatMap((l) => l.poolFamilyIds));
  for (const familyId of exposure.keys()) allowed.add(familyId);
  return [...all.values()].filter((q) => allowed.has(q.familyId));
}

function requireItems(items: ItemSpec[], code: string, message: string) {
  if (items.length === 0) throw conflict(code, message);
  return items;
}

async function selectLesson(ctx: SelectionContext, input: SelectionInput, exposure: Map<string, Exposure>): Promise<Selection> {
  if (!input.lessonId) throw badRequest('lesson_required', 'lesson_id is required for lesson sessions');
  const lesson = await Lesson.findOne({
    _id: input.lessonId,
    examVersionId: ctx.enrollment.examVersionId,
    status: 'published',
  }).lean();
  if (!lesson) throw notFound('Lesson');
  const path = await computePath(ctx.enrollment);
  const node = path.lessons.find((l) => l.id === lesson._id);
  if (!node || node.state === 'locked') throw conflict('lesson_locked', 'Finish the earlier lessons on your path first');

  const pool = await latestPublishedByFamily(ctx.enrollment.examVersionId, lesson.poolFamilyIds);
  const ordered = lesson.poolFamilyIds.map((id) => pool.get(id)).filter((q): q is QuestionVersionLean => !!q);
  // Checkpoints check transfer, so they prefer families the learner has not seen.
  const chosen = lesson.kind === 'checkpoint' ? rankFresh(ordered, exposure) : ordered;
  const items = requireItems(
    chosen.slice(0, lesson.questionCount).map((q) => toItem(q, exposure)),
    'no_published_content',
    'This lesson has no published questions yet',
  );
  return {
    mode: lesson.kind === 'checkpoint' ? 'checkpoint' : 'lesson',
    items,
    lessonId: lesson._id,
    deadlineAt: null,
    config: { lesson_kind: lesson.kind, pool_size: ordered.length },
  };
}

async function selectQuick(ctx: SelectionContext, input: SelectionInput, exposure: Map<string, Exposure>): Promise<Selection> {
  const size = ctx.features.has('full_bank') ? Math.min(input.questionCount ?? 5, 20) : 5;
  const scope = await practiceScope(ctx, exposure);
  const items = requireItems(
    rankFresh(scope, exposure).slice(0, size).map((q) => toItem(q, exposure)),
    'empty_selection',
    'No published questions are available yet',
  );
  return { mode: 'quick', items, lessonId: null, deadlineAt: null, config: { scope: ctx.features.has('full_bank') ? 'full_bank' : 'unlocked_path' } };
}

async function selectMissed(ctx: SelectionContext, input: SelectionInput, exposure: Map<string, Exposure>): Promise<Selection> {
  // Families whose latest graded, non-invalidated attempt is incorrect.
  const latest = await Attempt.aggregate<{ _id: string; isCorrect: boolean; at: Date }>([
    { $match: { userId: ctx.userId, examVersionId: ctx.enrollment.examVersionId, gradedAt: { $ne: null }, invalidatedAt: null } },
    { $sort: { gradedAt: -1 } },
    { $group: { _id: '$familyId', isCorrect: { $first: '$isCorrect' }, at: { $first: '$gradedAt' } } },
    { $match: { isCorrect: false } },
    { $sort: { at: 1 } },
  ]);
  const size = Math.min(input.questionCount ?? 5, 20);
  const revisions = await latestPublishedByFamily(ctx.enrollment.examVersionId, latest.map((l) => l._id));
  const items = requireItems(
    latest
      .map((l) => revisions.get(l._id))
      .filter((q): q is QuestionVersionLean => !!q)
      .slice(0, size)
      .map((q) => toItem(q, exposure)),
    'nothing_missed',
    'No missed questions to revisit. Nice work.',
  );
  return { mode: 'missed', items, lessonId: null, deadlineAt: null, config: { missed_available: latest.length } };
}

/**
 * Low first-seen accuracy with a minimum sample; otherwise the biggest coverage
 * gaps, heavier blueprint domains first.
 */
export async function rankObjectives(enrollmentId: string, objectiveIds: string[], weights: Map<string, number> = new Map()) {
  const progress = await ObjectiveProgress.find({ enrollmentId }).lean();
  const byObjective = new Map(progress.map((p) => [p.objectiveId, p]));
  const rows = objectiveIds.map((id) => {
    const p = byObjective.get(id);
    return { objectiveId: id, total: p?.firstSeenTotal ?? 0, correct: p?.firstSeenCorrect ?? 0, weight: weights.get(id) ?? 0 };
  });
  const ranked = rows
    .filter((r) => r.total >= MIN_RANKING_SAMPLE)
    .sort((a, b) => a.correct / a.total - b.correct / b.total)
    .map((r) => ({ ...r, reason: 'low_accuracy' as const }));
  const gaps = rows
    .filter((r) => r.total < MIN_RANKING_SAMPLE)
    .sort((a, b) => a.total - b.total || b.weight - a.weight)
    .map((r) => ({ ...r, reason: 'coverage_gap' as const }));
  // A weak, well-sampled objective outranks a gap only when it is clearly weak.
  const weak = ranked.filter((r) => r.correct / r.total < 0.7);
  return [...weak, ...gaps, ...ranked.filter((r) => r.correct / r.total >= 0.7)];
}

async function selectWeakest(ctx: SelectionContext, input: SelectionInput, exposure: Map<string, Exposure>): Promise<Selection> {
  const size = Math.min(input.questionCount ?? 5, 20);
  const scope = await practiceScope(ctx, exposure);
  const byObjective = new Map<string, QuestionVersionLean[]>();
  for (const q of scope) byObjective.set(q.objectiveId, [...(byObjective.get(q.objectiveId) ?? []), q]);
  const { domains, objectives } = await loadBlueprint(ctx.enrollment.examVersionId);
  const ranking = await rankObjectives(ctx.enrollment._id, [...byObjective.keys()], objectiveWeights(domains, objectives));
  const items: ItemSpec[] = [];
  for (const r of ranking) {
    for (const q of rankFresh(byObjective.get(r.objectiveId) ?? [], exposure)) {
      if (items.length >= size) break;
      items.push(toItem(q, exposure));
    }
    if (items.length >= size) break;
  }
  requireItems(items, 'empty_selection', 'No published questions are available yet');
  const focus = ranking[0];
  return {
    mode: 'weakest',
    items,
    lessonId: null,
    deadlineAt: null,
    config: { focus_objective_id: focus?.objectiveId ?? null, focus_reason: focus?.reason ?? null, min_sample: MIN_RANKING_SAMPLE },
  };
}

export function objectiveWeights(domains: { _id: string; weightPercent: number }[], objectives: { _id: string; domainId: string }[]) {
  const weight = new Map(domains.map((d) => [d._id, d.weightPercent]));
  return new Map(objectives.map((o) => [o._id, weight.get(o.domainId) ?? 0]));
}

async function selectReview(ctx: SelectionContext, input: SelectionInput, exposure: Map<string, Exposure>): Promise<Selection> {
  const due = await ReviewQueue.find({ enrollmentId: ctx.enrollment._id, dueAt: { $lte: ctx.now } }).sort({ dueAt: 1 }).lean();
  if (due.length === 0) throw conflict('nothing_due', "You're caught up. No reviews are due.");
  const size = Math.min(input.questionCount ?? 5, 20);
  // Due review is always free, so it draws from the whole objective, preferring a fresh scenario.
  const all = await latestPublishedByFamily(ctx.enrollment.examVersionId);
  const queues = due.map((d) => rankFresh([...all.values()].filter((q) => q.objectiveId === d.objectiveId), exposure));
  const items: ItemSpec[] = [];
  for (let round = 0; items.length < size; round++) {
    let added = false;
    for (const queue of queues) {
      const q = queue[round];
      if (q && items.length < size) {
        items.push(toItem(q, exposure));
        added = true;
      }
    }
    if (!added) break;
  }
  requireItems(items, 'empty_selection', 'No published questions are available for your due concepts');
  return { mode: 'review', items, lessonId: null, deadlineAt: null, config: { due_objectives: due.length } };
}

async function selectCustom(ctx: SelectionContext, input: SelectionInput, exposure: Map<string, Exposure>): Promise<Selection> {
  if (!ctx.features.has('custom_quiz')) throw plusRequired('custom_quiz');
  const { version, domains } = await loadBlueprint(ctx.enrollment.examVersionId);
  const domainIds = input.domainIds?.length ? input.domainIds : domains.map((d) => d._id);
  const valid = new Set(domains.map((d) => d._id));
  if (domainIds.some((id) => !valid.has(id))) throw badRequest('invalid_domain', 'A selected domain is not part of this exam version');
  const requested = Math.min(input.questionCount ?? 10, 50);
  const all = await latestPublishedByFamily(ctx.enrollment.examVersionId);
  const pool = [...all.values()].filter((q) => domainIds.includes(q.domainId));
  const items = requireItems(
    rankFresh(pool, exposure).slice(0, requested).map((q) => toItem(q, exposure)),
    'empty_selection',
    'No published questions match the selected domains',
  );
  const timed = input.mode === 'timed';
  const secondsPerItem = (version.durationMinutes * 60) / version.questionCount;
  return {
    mode: input.mode,
    items,
    lessonId: null,
    deadlineAt: timed ? new Date(ctx.now.getTime() + Math.ceil(items.length * secondsPerItem) * 1000) : null,
    config: { domain_ids: domainIds, requested, assigned: items.length, seconds_per_item: timed ? secondsPerItem : null },
  };
}

/**
 * A full mock is a blueprint-balanced form of the version's size. If inventory
 * cannot fill any domain, it fails cleanly and offers a clearly labelled sample.
 */
async function selectMock(ctx: SelectionContext, input: SelectionInput, exposure: Map<string, Exposure>): Promise<Selection> {
  const { version, domains } = await loadBlueprint(ctx.enrollment.examVersionId);
  const full = input.questionCount === undefined || input.questionCount === version.questionCount;
  if (!full && input.questionCount! > SAMPLE_MOCK_SIZE) {
    throw badRequest('invalid_mock_size', `Choose the full ${version.questionCount}-question mock or a sample of up to ${SAMPLE_MOCK_SIZE}`);
  }
  if (full && !ctx.features.has('mocks')) throw plusRequired('mocks');
  if (!full && !ctx.features.has('mocks')) {
    const today = localDate(ctx.now, ctx.timezone);
    const samplesToday = await PracticeSession.countDocuments({
      userId: ctx.userId,
      mode: 'mock',
      'selectionConfig.sample': true,
      startedAt: { $gte: startOfLocalDay(today, ctx.timezone) },
    });
    if (samplesToday >= 1) {
      throw new HttpError(403, 'plus_required', 'The free plan includes one sample mock per day', { feature: 'mocks' });
    }
  }

  const size = full ? version.questionCount : input.questionCount!;
  const all = await latestPublishedByFamily(ctx.enrollment.examVersionId);
  const byDomain = domains.map((d) => rankFresh([...all.values()].filter((q) => q.domainId === d._id), exposure));
  const allocation = allocateBlueprint(size, domains.map((d) => d.weightPercent));

  const shortfall = domains
    .map((d, i) => ({ domain_id: d._id, title: d.title, required: allocation[i]!, available: byDomain[i]!.length }))
    .filter((d) => d.available < d.required);
  if (full && shortfall.length > 0) {
    throw conflict('insufficient_inventory', 'There are not enough reviewed questions for a full mock yet', {
      shortfall,
      sample_size: SAMPLE_MOCK_SIZE,
    });
  }

  // Samples cap each domain at its inventory and move the remainder to domains with spare questions.
  const counts = allocation.map((n, i) => Math.min(n, byDomain[i]!.length));
  let missing = size - counts.reduce((a, b) => a + b, 0);
  const byWeight = domains.map((d, i) => ({ i, w: d.weightPercent })).sort((a, b) => b.w - a.w);
  while (missing > 0) {
    const target = byWeight.find(({ i }) => counts[i]! < byDomain[i]!.length);
    if (!target) break;
    counts[target.i]!++;
    missing--;
  }

  const picked = shuffle(byDomain.flatMap((qs, i) => qs.slice(0, counts[i]!)));
  const items = requireItems(picked.map((q) => toItem(q, exposure)), 'empty_selection', 'No published questions are available yet');
  const minutes = full ? version.durationMinutes : Math.ceil((version.durationMinutes * items.length) / version.questionCount);
  return {
    mode: 'mock',
    items,
    lessonId: null,
    deadlineAt: new Date(ctx.now.getTime() + minutes * 60_000),
    config: {
      sample: !full,
      full_form_size: version.questionCount,
      duration_minutes: minutes,
      allocation: domains.map((d, i) => ({ domain_id: d._id, count: counts[i] })),
      fresh_count: items.filter((i) => !i.repeat).length,
    },
  };
}

export async function selectItems(ctx: SelectionContext, input: SelectionInput): Promise<Selection> {
  const exposure = await exposureMap(ctx.userId, ctx.enrollment.examVersionId);
  switch (input.mode) {
    case 'lesson':
    case 'checkpoint':
      return selectLesson(ctx, input, exposure);
    case 'quick':
      return selectQuick(ctx, input, exposure);
    case 'missed':
      return selectMissed(ctx, input, exposure);
    case 'weakest':
      return selectWeakest(ctx, input, exposure);
    case 'review':
      return selectReview(ctx, input, exposure);
    case 'timed':
    case 'custom':
      return selectCustom(ctx, input, exposure);
    case 'mock':
      return selectMock(ctx, input, exposure);
  }
}

/** Inventory facts for the practice hub, without starting a session. */
export async function mockInventory(examVersionId: string) {
  const { version, domains } = await loadBlueprint(examVersionId);
  const all = await latestPublishedByFamily(examVersionId);
  const allocation = allocateBlueprint(version.questionCount, domains.map((d) => d.weightPercent));
  const available = domains.map((d) => [...all.values()].filter((q) => q.domainId === d._id).length);
  return {
    full_form_size: version.questionCount,
    duration_minutes: version.durationMinutes,
    full_form_available: allocation.every((n, i) => available[i]! >= n),
    published_questions: all.size,
    sample_size: Math.min(SAMPLE_MOCK_SIZE, all.size),
    sample_minutes: Math.ceil((version.durationMinutes * Math.min(SAMPLE_MOCK_SIZE, all.size)) / version.questionCount),
  };
}

