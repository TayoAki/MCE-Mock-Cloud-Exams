import { tx } from '../db.js';
import { Enrollment, PracticeSession, QuestionFamily, QuestionVersion, Story } from '../models/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { UserRecord } from '../models/index.js';

/** Published stories for an enrollment's exam version, with the learner's progress. */
export async function listStories(userId: string, enrollmentId: string) {
  const enrollment = await Enrollment.findOne({ _id: enrollmentId, userId }).lean();
  if (!enrollment) throw notFound('Enrollment');
  const stories = await Story.find({ examVersionId: enrollment.examVersionId, status: 'published' }).sort({ sortOrder: 1 }).lean();
  const sessions = await PracticeSession.find({ userId, enrollmentId, mode: 'story', status: { $in: ['active', 'completed'] } })
    .select({ status: 1, selectionConfig: 1 })
    .lean();
  const storyOf = (s: { selectionConfig?: unknown }) => (s.selectionConfig as { story_id?: string } | undefined)?.story_id;
  const completed = new Set(sessions.filter((s) => s.status === 'completed').map(storyOf));
  const active = new Map(sessions.filter((s) => s.status === 'active').map((s) => [storyOf(s), s._id]));
  return stories.map((s) => ({
    id: s._id,
    title: s.title,
    summary: s.summary,
    characters: s.characters.map((c) => ({ name: c.name, role: c.role })),
    question_count: s.parts.filter((p) => p.kind === 'question').length,
    completed: completed.has(s._id),
    active_session_id: active.get(s._id) ?? null,
  }));
}

// ---------- Backoffice ----------

export interface StoryInput {
  exam_version_id: string;
  slug: string;
  title: string;
  summary?: string;
  characters: { name: string; role: string }[];
  /** Lines and questions in order; questions name bank families by key. */
  parts: ({ kind: 'line'; speaker?: string | null; text: string } | { kind: 'question'; family_key: string })[];
  status: 'draft' | 'published' | 'retired';
}

async function storyView(id: string) {
  const story = await Story.findById(id).lean();
  if (!story) throw notFound('Story');
  const families = new Map(
    (await QuestionFamily.find({ _id: { $in: story.parts.flatMap((p) => (p.familyId ? [p.familyId] : [])) } }).select({ familyKey: 1 }).lean()).map((f) => [f._id, f.familyKey]),
  );
  return {
    id: story._id,
    exam_version_id: story.examVersionId,
    slug: story.slug,
    title: story.title,
    summary: story.summary,
    characters: story.characters.map((c) => ({ name: c.name, role: c.role })),
    parts: story.parts.map((p) => (p.kind === 'line' ? { kind: 'line' as const, speaker: p.speaker ?? null, text: p.text ?? '' } : { kind: 'question' as const, family_key: families.get(p.familyId!) ?? '' })),
    status: story.status,
    updated_at: story.updatedAt.toISOString(),
  };
}

export async function listStoriesAdmin(examVersionId: string) {
  const stories = await Story.find({ examVersionId }).sort({ sortOrder: 1 }).lean();
  return Promise.all(stories.map((s) => storyView(s._id)));
}

export const getStoryAdmin = storyView;

/**
 * Creates or replaces a story. Questions are bank families by key; they are
 * tagged with the story so regular practice never serves them out of context.
 * A published story needs every question to have a published revision.
 */
export async function saveStory(_actor: UserRecord, input: StoryInput, storyId?: string) {
  const characterNames = new Set(input.characters.map((c) => c.name));
  for (const p of input.parts) {
    if (p.kind === 'line' && p.speaker && !characterNames.has(p.speaker)) throw badRequest('unknown_speaker', `${p.speaker} is not one of the story's characters`);
  }
  const keys = input.parts.flatMap((p) => (p.kind === 'question' ? [p.family_key] : []));
  if (!keys.length) throw badRequest('story_without_questions', 'A story needs at least one question');
  if (new Set(keys).size !== keys.length) throw badRequest('duplicate_question', 'Each question can appear once per story');
  const families = await QuestionFamily.find({ examVersionId: input.exam_version_id, familyKey: { $in: keys } }).lean();
  const byKey = new Map(families.map((f) => [f.familyKey, f._id]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length) throw badRequest('unknown_question', `No question family ${missing[0]} in this exam version`, { missing });
  if (input.status === 'published') {
    const published = await QuestionVersion.distinct('familyId', { familyId: { $in: [...byKey.values()] }, status: 'published' });
    if (published.length !== byKey.size) throw conflict('questions_unpublished', 'Publish every question in the story before publishing it');
  }

  const id = await tx(async () => {
    const clash = await Story.findOne({ examVersionId: input.exam_version_id, slug: input.slug, ...(storyId ? { _id: { $ne: storyId } } : {}) }).lean();
    if (clash) throw conflict('slug_taken', 'Another story already uses this slug');
    const story = storyId ? await Story.findById(storyId) : new Story({ examVersionId: input.exam_version_id, sortOrder: (await Story.countDocuments({ examVersionId: input.exam_version_id })) + 1 });
    if (!story) throw notFound('Story');
    const before = new Set(story.parts.flatMap((p) => (p.familyId ? [p.familyId] : [])));
    story.set({
      slug: input.slug,
      title: input.title,
      summary: input.summary ?? '',
      characters: input.characters,
      parts: input.parts.map((p) => (p.kind === 'line' ? { kind: 'line', speaker: p.speaker ?? null, text: p.text } : { kind: 'question', familyId: byKey.get(p.family_key)! })),
      status: input.status,
      updatedAt: new Date(),
    });
    await story.save();
    const now = new Set(byKey.values());
    await QuestionVersion.updateMany({ familyId: { $in: [...now] } }, { $set: { storyId: story._id } });
    const dropped = [...before].filter((f) => !now.has(f));
    if (dropped.length) await QuestionVersion.updateMany({ familyId: { $in: dropped }, storyId: story._id }, { $set: { storyId: null } });
    return story._id;
  });
  return storyView(id);
}
