import {
  Attempt,
  Domain,
  Enrollment,
  ExamVersion,
  Lesson,
  LessonProgress,
  Objective,
  PracticeSession,
  QuestionKey,
  Story,
  Unit,
  type AnswerType,
  type SessionMode,
} from '../models/index.js';
import { track } from '../lib/analytics.js';
import { HttpError, conflict, isDuplicateKey, notFound } from '../lib/errors.js';
import { effectiveTimezone } from '../lib/time.js';
import type { UserRecord } from '../models/index.js';
import { featureSet } from './access.js';
import { finalizeSession } from './completion.js';
import { loadQuestionVersions } from './content.js';
import { DELAYED_FEEDBACK_MODES, buildFeedback, type Feedback } from './grading.js';
import { selectItems } from './selection.js';

export interface StartInput {
  enrollment_id: string;
  client_session_id: string;
  mode: SessionMode;
  lesson_id?: string;
  story_id?: string;
  domain_ids?: string[];
  question_count?: number;
}

type StoryPartView = { kind: 'line'; speaker: string | null; text: string } | { kind: 'question'; session_item_id: string };

type SessionLean = Omit<NonNullable<Awaited<ReturnType<typeof loadSession>>>, '__v'>;

function loadSession(userId: string, sessionId: string) {
  return PracticeSession.findOne({ _id: sessionId, userId }).lean();
}

/** Loads an owned session, expiring it first if its server deadline passed while away. */
export async function getOwnedSession(userId: string, sessionId: string): Promise<SessionLean> {
  let session = await loadSession(userId, sessionId);
  if (!session) throw notFound('Session');
  if (session.status === 'active' && session.deadlineAt && session.deadlineAt <= new Date()) {
    await finalizeSession(sessionId, { userId, reason: 'expire' });
    session = (await loadSession(userId, sessionId))!;
  }
  return session;
}

export async function startSession(user: UserRecord, input: StartInput) {
  const existing = await PracticeSession.findOne({ userId: user._id, clientSessionId: input.client_session_id }).lean();
  if (existing) {
    const sameRequest =
      existing.enrollmentId === input.enrollment_id &&
      (existing.mode === input.mode || (input.mode === 'lesson' && existing.mode === 'checkpoint')) &&
      (input.lesson_id ?? null) === (existing.lessonId ?? null);
    if (!sameRequest) throw conflict('idempotency_conflict', 'This session ID was already used for a different session');
    return sessionView(await getOwnedSession(user._id, existing._id));
  }

  const enrollment = await Enrollment.findOne({ _id: input.enrollment_id, userId: user._id }).lean();
  if (!enrollment) throw notFound('Enrollment');
  const version = await ExamVersion.findById(enrollment.examVersionId).lean();
  if (!version || version.status === 'draft') throw conflict('version_unavailable', 'This exam version is not available');

  // Reopening the app resumes the same unfinished lesson and its assigned revisions.
  if (input.lesson_id) {
    const active = await PracticeSession.findOne({
      userId: user._id,
      enrollmentId: enrollment._id,
      lessonId: input.lesson_id,
      status: 'active',
    }).lean();
    if (active) return sessionView(await getOwnedSession(user._id, active._id));
  }
  if (input.story_id) {
    const active = await PracticeSession.findOne({ userId: user._id, enrollmentId: enrollment._id, mode: 'story', 'selectionConfig.story_id': input.story_id, status: 'active' }).lean();
    if (active) return sessionView(await getOwnedSession(user._id, active._id));
  }

  const now = new Date();
  const features = await featureSet(user._id, now);
  const selection = await selectItems(
    {
      userId: user._id,
      timezone: effectiveTimezone(user, now),
      enrollment: { _id: enrollment._id, examVersionId: enrollment.examVersionId },
      features,
      now,
    },
    { mode: input.mode, lessonId: input.lesson_id, storyId: input.story_id, domainIds: input.domain_ids, questionCount: input.question_count },
  );

  let created;
  try {
    created = await PracticeSession.create({
      userId: user._id,
      enrollmentId: enrollment._id,
      examVersionId: enrollment.examVersionId,
      lessonId: selection.lessonId,
      mode: selection.mode,
      questionCount: selection.items.length,
      clientSessionId: input.client_session_id,
      selectionConfig: {
        ...selection.config,
        // Admission snapshot: a learner admitted to a mock may finish it after access ends.
        admission: { features: [...features].sort(), at: now.toISOString() },
      },
      items: selection.items.map((it, i) => ({ ...it, position: i + 1 })),
      startedAt: now,
      deadlineAt: selection.deadlineAt,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const winner = await PracticeSession.findOne({ userId: user._id, clientSessionId: input.client_session_id }).lean();
    if (!winner) throw err;
    return sessionView(await getOwnedSession(user._id, winner._id));
  }

  if (selection.lessonId) {
    await LessonProgress.updateOne(
      { enrollmentId: enrollment._id, lessonId: selection.lessonId, state: { $ne: 'completed' } },
      { $set: { state: 'in_progress', startedAt: now }, $setOnInsert: { userId: user._id } },
      { upsert: true },
    ).catch((err) => {
      // A completed lesson being replayed keeps its completed state.
      if (!isDuplicateKey(err)) throw err;
    });
  }

  track('session_started', {
    userId: user._id,
    examVersionId: enrollment.examVersionId,
    sessionId: created._id,
    properties: { mode: created.mode, question_count: created.questionCount, sample: !!selection.config.sample },
  });
  return sessionView(created.toObject());
}

/**
 * Client payload for a session. Prompts never include keys or rationale; feedback
 * appears for answered learning items, and for mocks only after finalization.
 */
export async function sessionView(session: SessionLean) {
  const [questions, attempts, objectives, domains, lesson] = await Promise.all([
    loadQuestionVersions(session.items.map((i) => i.questionVersionId)),
    Attempt.find({ sessionId: session._id }).lean(),
    Objective.find({ _id: { $in: [...new Set(session.items.map((i) => i.objectiveId))] } }).select({ title: 1 }).lean(),
    Domain.find({ _id: { $in: [...new Set(session.items.map((i) => i.domainId))] } }).select({ title: 1 }).lean(),
    session.lessonId ? Lesson.findById(session.lessonId).select({ title: 1, unitId: 1 }).lean() : null,
  ]);
  const unit = lesson ? await Unit.findById(lesson.unitId).select({ title: 1 }).lean() : null;
  const finalized = session.status === 'completed' || session.status === 'expired';
  const revealFeedback = finalized || !DELAYED_FEEDBACK_MODES.has(session.mode);

  const byQuestion = new Map(questions.map((q) => [q._id, q]));
  const byItem = new Map(attempts.map((a) => [a.sessionItemId, a]));
  const objectiveTitles = new Map(objectives.map((o) => [o._id, o.title]));
  const domainTitles = new Map(domains.map((d) => [d._id, d.title]));
  const keyIds = revealFeedback ? attempts.filter((a) => a.isCorrect != null).map((a) => a.questionVersionId) : [];
  const keys = new Map((await QuestionKey.find({ _id: { $in: keyIds } }).lean()).map((k) => [k._id, k]));

  const items = session.items.map((item) => {
    const q = byQuestion.get(item.questionVersionId);
    if (!q) throw new HttpError(500, 'content_missing', 'Assigned question content is missing');
    const attempt = byItem.get(item._id);
    const key = attempt ? keys.get(attempt.questionVersionId) : undefined;
    const feedback: Feedback | null = attempt && attempt.isCorrect != null && key ? buildFeedback(attempt.isCorrect, key, q.sourceUrl, q.answerType as AnswerType) : null;
    return {
      session_item_id: item._id,
      question_version_id: q._id,
      family_id: item.familyId,
      position: item.position,
      prompt: q.prompt,
      answer_type: q.answerType,
      options: q.options.map((o) => ({ key: o.key, text: o.text })),
      match_targets: (q.matchTargets ?? []).map((t) => ({ key: t.key, text: t.text })),
      presentation: q.presentation ?? 'text',
      input_hint: q.inputHint ?? null,
      objective_title: objectiveTitles.get(item.objectiveId) ?? '',
      domain_title: domainTitles.get(item.domainId) ?? '',
      repeat: item.repeat,
      submission: attempt
        ? {
            attempt_id: attempt._id,
            selected_options: attempt.selectedOptions,
            typed_answer: attempt.typedAnswer ?? null,
            submitted_at: attempt.submittedAt.toISOString(),
            feedback,
          }
        : null,
    };
  });

  const config = (session.selectionConfig ?? {}) as Record<string, unknown>;
  const story = session.mode === 'story' && typeof config.story_id === 'string' ? await Story.findById(config.story_id).lean() : null;
  const itemByFamily = new Map(session.items.map((i) => [i.familyId, i._id]));
  return {
    id: session._id,
    mode: session.mode,
    status: session.status,
    enrollment_id: session.enrollmentId,
    lesson: lesson ? { id: lesson._id, title: lesson.title, unit_title: unit?.title ?? '' } : null,
    deadline_at: session.deadlineAt ? session.deadlineAt.toISOString() : null,
    started_at: session.startedAt.toISOString(),
    server_time: new Date().toISOString(),
    question_count: session.questionCount,
    answered_count: attempts.length,
    sample: !!config.sample,
    feedback_timing: DELAYED_FEEDBACK_MODES.has(session.mode) ? 'after_submit' : 'per_answer',
    items,
    completion: session.completion ?? null,
    story: story
      ? {
          id: story._id,
          title: story.title,
          characters: story.characters.map((c) => ({ name: c.name, role: c.role })),
          // Questions whose family has no published revision are skipped, like any unavailable item.
          parts: story.parts.flatMap((p): StoryPartView[] =>
            p.kind === 'line'
              ? [{ kind: 'line' as const, speaker: p.speaker ?? null, text: p.text ?? '' }]
              : itemByFamily.has(p.familyId!)
                ? [{ kind: 'question' as const, session_item_id: itemByFamily.get(p.familyId!)! }]
                : [],
          ),
        }
      : null,
  };
}

export async function listActiveSessions(userId: string) {
  const sessions = await PracticeSession.find({ userId, status: 'active' })
    .sort({ startedAt: -1 })
    .limit(20)
    .lean();
  const now = new Date();
  const live = [];
  for (const s of sessions) {
    if (s.deadlineAt && s.deadlineAt <= now) {
      await finalizeSession(s._id, { userId, reason: 'expire' }).catch(() => undefined);
      continue;
    }
    const answered = await Attempt.countDocuments({ sessionId: s._id });
    live.push({
      id: s._id,
      mode: s.mode,
      enrollment_id: s.enrollmentId,
      lesson_id: s.lessonId,
      question_count: s.questionCount,
      answered_count: answered,
      deadline_at: s.deadlineAt?.toISOString() ?? null,
      started_at: s.startedAt.toISOString(),
      sample: !!(s.selectionConfig as { sample?: boolean })?.sample,
    });
  }
  return live;
}

/** Abandoning earns nothing and frees the learner to start over. Mocks can't be abandoned. */
export async function abandonSession(userId: string, sessionId: string) {
  const session = await getOwnedSession(userId, sessionId);
  if (session.status !== 'active') return { id: session._id, status: session.status };
  if (session.mode === 'mock') throw conflict('mock_in_progress', 'Submit the mock to see your results; the timer keeps running');
  await PracticeSession.updateOne({ _id: sessionId, userId, status: 'active' }, { $set: { status: 'abandoned' }, $inc: { lockVersion: 1 } });
  if (session.lessonId) {
    const others = await PracticeSession.countDocuments({ userId, lessonId: session.lessonId, status: 'active' });
    if (others === 0) {
      await LessonProgress.deleteOne({ enrollmentId: session.enrollmentId, lessonId: session.lessonId, state: 'in_progress' });
    }
  }
  return { id: session._id, status: 'abandoned' };
}

export async function sessionResults(userId: string, sessionId: string) {
  const session = await getOwnedSession(userId, sessionId);
  if (!session.completion) throw conflict('not_finalized', 'Results are available after the session is finished');
  return session.completion;
}

/** Reviewed feedback for every item, available once the session is finalized. */
export async function sessionFeedback(userId: string, sessionId: string) {
  const session = await getOwnedSession(userId, sessionId);
  const finalized = session.status === 'completed' || session.status === 'expired';
  if (!finalized && DELAYED_FEEDBACK_MODES.has(session.mode)) {
    throw conflict('not_finalized', 'Feedback for a mock is available after you submit it');
  }
  const [questions, attempts] = await Promise.all([
    loadQuestionVersions(session.items.map((i) => i.questionVersionId)),
    Attempt.find({ sessionId: session._id }).lean(),
  ]);
  const byItem = new Map(attempts.map((a) => [a.sessionItemId, a]));
  // Only reveal keys for items the learner may now see: all items once finalized, else answered ones.
  const visible = session.items.filter((i) => finalized || byItem.has(i._id));
  const keys = new Map((await QuestionKey.find({ _id: { $in: visible.map((i) => i.questionVersionId) } }).lean()).map((k) => [k._id, k]));
  const byQuestion = new Map(questions.map((q) => [q._id, q]));
  return {
    session_id: session._id,
    status: session.status,
    items: visible.map((item) => {
      const q = byQuestion.get(item.questionVersionId)!;
      const attempt = byItem.get(item._id);
      const key = keys.get(item.questionVersionId)!;
      return {
        session_item_id: item._id,
        position: item.position,
        prompt: q.prompt,
        answer_type: q.answerType,
        options: q.options.map((o) => ({ key: o.key, text: o.text })),
        match_targets: (q.matchTargets ?? []).map((t) => ({ key: t.key, text: t.text })),
        selected_options: attempt?.selectedOptions ?? [],
        typed_answer: attempt?.typedAnswer ?? null,
        attempt_id: attempt?._id ?? null,
        answered: !!attempt,
        feedback: buildFeedback(attempt?.isCorrect === true, key, q.sourceUrl, q.answerType as AnswerType),
      };
    }),
  };
}
