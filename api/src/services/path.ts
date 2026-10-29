import { LessonProgress, PracticeSession } from '../models/index.js';
import { orderedLessons } from './content.js';

export type LessonState = 'locked' | 'available' | 'in_progress' | 'completed' | 'placed_out';

interface EnrollmentRef {
  _id: string;
  examVersionId: string;
}

/**
 * Lessons unlock in order. A lesson completes when every assigned item is
 * submitted and feedback is available; completion does not mean mastery.
 */
export async function computePath(enrollment: EnrollmentRef) {
  const [{ units, lessons }, progress, active] = await Promise.all([
    orderedLessons(enrollment.examVersionId),
    LessonProgress.find({ enrollmentId: enrollment._id }).lean(),
    PracticeSession.find({
      enrollmentId: enrollment._id,
      status: 'active',
      lessonId: { $ne: null },
    })
      .select({ _id: 1, lessonId: 1 })
      .lean(),
  ]);
  const progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));
  const activeByLesson = new Map(active.map((s) => [s.lessonId!, s._id]));
  const unitTitles = new Map(units.map((u) => [u._id, u]));

  let currentLessonId: string | null = null;
  const nodes = lessons.map((lesson) => {
    const p = progressByLesson.get(lesson._id);
    let state: LessonState;
    if (p?.state === 'completed' || p?.state === 'placed_out') {
      state = p.state;
    } else if (currentLessonId === null) {
      currentLessonId = lesson._id;
      state = p?.state === 'in_progress' || activeByLesson.has(lesson._id) ? 'in_progress' : 'available';
    } else {
      state = 'locked';
    }
    const unit = unitTitles.get(lesson.unitId);
    return {
      id: lesson._id,
      title: lesson.title,
      summary: lesson.summary,
      kind: lesson.kind,
      state,
      question_count: lesson.questionCount,
      unit_id: lesson.unitId,
      unit_title: unit?.title ?? '',
      active_session_id: activeByLesson.get(lesson._id) ?? null,
    };
  });

  return {
    enrollment_id: enrollment._id,
    current_lesson_id: currentLessonId as string | null,
    lessons: nodes,
    units: units
      .map((u) => ({
        id: u._id,
        title: u.title,
        subtitle: u.subtitle,
        lesson_ids: nodes.filter((n) => n.unit_id === u._id).map((n) => n.id),
      }))
      .filter((u) => u.lesson_ids.length > 0),
  };
}

/** Lessons a free learner can draw practice from: completed ones plus the current one. */
export async function unlockedLessonIds(enrollment: EnrollmentRef) {
  const path = await computePath(enrollment);
  return path.lessons.filter((l) => l.state !== 'locked').map((l) => l.id);
}
