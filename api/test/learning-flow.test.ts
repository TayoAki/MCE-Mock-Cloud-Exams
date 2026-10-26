import { describe, expect, it } from 'vitest';
import { Attempt, DailyStudyDay, ReviewQueue, RewardLedger, StreakState } from '../src/models/index.js';
import { SAMPLE_PICKS, answerAll, as, completeLesson, enroll, guest, id, lessonId, pilotVersionId, startLesson } from './helpers.js';

describe('catalog and enrollment', () => {
  it('lists the pilot as enrollable and planned banks as not', async () => {
    const res = await as().get('/exams').expect(200);
    const byTitle = Object.fromEntries(res.body.exams.map((e: { title: string; enrollable: boolean }) => [e.title, e.enrollable]));
    expect(byTitle).toEqual({ Databricks: true, AWS: false, 'Microsoft Fabric': false });
  });

  it('enrollment is idempotent by request ID and by exam version', async () => {
    const { token } = await guest();
    const versionId = await pilotVersionId();
    const key = id();
    const a = await as(token).post('/enrollments', { exam_version_id: versionId, client_request_id: key }).expect(201);
    const b = await as(token).post('/enrollments', { exam_version_id: versionId, client_request_id: key }).expect(201);
    const c = await as(token).post('/enrollments', { exam_version_id: versionId, client_request_id: id() }).expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect(c.body.id).toBe(a.body.id);
    await as(token).post('/enrollments', { exam_version_id: versionId, client_request_id: key, exam_date: '2027-01-01' }).expect(409);
  });

  it('rejects unauthenticated requests and unknown enrollments', async () => {
    await as().get('/me').expect(401);
    const { token } = await guest();
    await as(token).get(`/enrollments/${id()}/path`).expect(404);
    await as(token).get('/enrollments/not-a-uuid/path').expect(404);
  });
});

describe('the daily lesson loop', () => {
  it('scores the sample walkthrough 3/5 for 75 XP and one study day', async () => {
    const { token, userId } = await guest();
    const enrollmentId = await enroll(token);
    const session = await startLesson(token, enrollmentId);
    expect(session.items).toHaveLength(5);
    // Prompts never carry keys or rationale.
    for (const item of session.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'answer_type',
          'domain_title',
          'family_id',
          'input_hint',
          'match_targets',
          'objective_title',
          'options',
          'position',
          'presentation',
          'prompt',
          'question_version_id',
          'repeat',
          'session_item_id',
          'submission',
        ].sort(),
      );
    }
    const receipts = await answerAll(token, session);
    expect(receipts.map((r) => r.feedback.correct)).toEqual([true, false, true, true, false]);
    expect(receipts.every((r) => r.feedback.rationale && r.feedback.sources.length === 1)).toBe(true);

    const done = await as(token).post(`/sessions/${session.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ correct: 3, total: 5, xp_granted: 75, study_day_credited: true, current_streak: 1, status: 'completed' });
    expect(done.body.practice_score_note).toBe('Practice score; not a pass prediction.');

    const me = await as(token).get('/me').expect(200);
    expect(me.body.xp_total).toBe(75);
    expect(me.body.streak.current).toBe(1);
    expect(await DailyStudyDay.countDocuments({ userId })).toBe(1);
  });

  it('retrying completion returns the same summary and grants nothing twice', async () => {
    const { token, userId } = await guest();
    const enrollmentId = await enroll(token);
    const session = await startLesson(token, enrollmentId);
    await answerAll(token, session);
    const results = await Promise.all([1, 2, 3].map(() => as(token).post(`/sessions/${session.id}/complete`)));
    for (const r of results) expect(r.status).toBe(200);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    const xp = await RewardLedger.aggregate([{ $match: { userId } }, { $group: { _id: null, xp: { $sum: '$amount' } } }]);
    expect(xp[0].xp).toBe(75);
    expect(await DailyStudyDay.countDocuments({ userId })).toBe(1);
  });

  it('replaying a lesson earns no new XP and no second credit that day', async () => {
    const { token } = await guest();
    const enrollmentId = await enroll(token);
    const first = await completeLesson(token, enrollmentId);
    const replay = await completeLesson(token, enrollmentId, first.lesson_id);
    expect(replay).toMatchObject({ xp_granted: 0, study_day_credited: false, current_streak: 1 });
  });

  it('unlocks the next lesson only after completion and resumes an unfinished lesson', async () => {
    const { token } = await guest();
    const enrollmentId = await enroll(token);
    const locked = await lessonId('Cleanup');
    await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'lesson', lesson_id: locked }).expect(409);

    const first = await startLesson(token, enrollmentId);
    await as(token)
      .post(`/sessions/${first.id}/answers`, { session_item_id: first.items[0].session_item_id, client_submission_id: id(), selected_options: ['A'] })
      .expect(200);
    // Reopening resumes the same session and the same assigned revisions.
    const resumed = await startLesson(token, enrollmentId);
    expect(resumed.id).toBe(first.id);
    expect(resumed.items.map((i: { question_version_id: string }) => i.question_version_id)).toEqual(first.items.map((i: { question_version_id: string }) => i.question_version_id));
    expect(resumed.items[0].submission.feedback.correct).toBe(true);

    await as(token).post(`/sessions/${first.id}/complete`).expect(409);
    await answerAll(token, { id: first.id, items: first.items.slice(1) }, SAMPLE_PICKS.slice(1));
    await as(token).post(`/sessions/${first.id}/complete`).expect(200);
    const path = await as(token).get(`/enrollments/${enrollmentId}/path`).expect(200);
    expect(path.body.lessons.slice(0, 3).map((l: { state: string }) => l.state)).toEqual(['completed', 'available', 'locked']);
    await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'lesson', lesson_id: locked }).expect(201);
  });
});

describe('answer safety', () => {
  it('a retried submission returns the original grade; a changed body under the same ID is a 409', async () => {
    const { token, userId } = await guest();
    const session = await startLesson(token, await enroll(token));
    const item = session.items[1];
    const submission = { session_item_id: item.session_item_id, client_submission_id: id(), selected_options: ['B'] };
    const first = await as(token).post(`/sessions/${session.id}/answers`, submission).expect(200);
    const retry = await as(token).post(`/sessions/${session.id}/answers`, submission).expect(200);
    expect(retry.body.attempt_id).toBe(first.body.attempt_id);
    expect(retry.body.feedback).toEqual(first.body.feedback);
    await as(token).post(`/sessions/${session.id}/answers`, { ...submission, selected_options: ['A'] }).expect(409);
    // A final answer is immutable, even under a new submission ID.
    const again = await as(token).post(`/sessions/${session.id}/answers`, { ...submission, client_submission_id: id(), selected_options: ['A'] }).expect(409);
    expect(again.body.code).toBe('already_answered');
    expect(await Attempt.countDocuments({ userId })).toBe(1);
  });

  it('concurrent duplicate submissions commit exactly one attempt', async () => {
    const { token, userId } = await guest();
    const session = await startLesson(token, await enroll(token));
    const submission = { session_item_id: session.items[0].session_item_id, client_submission_id: id(), selected_options: ['A'] };
    const results = await Promise.all([1, 2, 3, 4].map(() => as(token).post(`/sessions/${session.id}/answers`, submission)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body.attempt_id)).size).toBe(1);
    expect(await Attempt.countDocuments({ userId })).toBe(1);
    expect(await RewardLedger.countDocuments({ userId })).toBe(2);
  });

  it('rejects options outside the question and wrong cardinality', async () => {
    const { token } = await guest();
    const session = await startLesson(token, await enroll(token));
    const item = session.items[0].session_item_id;
    const bad = await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: item, client_submission_id: id(), selected_options: ['Z'] }).expect(400);
    expect(bad.body.code).toBe('invalid_option');
    const many = await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: item, client_submission_id: id(), selected_options: ['A', 'B'] }).expect(400);
    expect(many.body.code).toBe('invalid_cardinality');
    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: id(), client_submission_id: id(), selected_options: ['A'] }).expect(400);
    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: item, client_submission_id: id(), selected_options: ['A'], user_id: id() }).expect(400);
  });

  it("never lets one learner read or answer another learner's session", async () => {
    const owner = await guest();
    const other = await guest();
    const session = await startLesson(owner.token, await enroll(owner.token));
    await as(other.token).get(`/sessions/${session.id}`).expect(404);
    await as(other.token)
      .post(`/sessions/${session.id}/answers`, { session_item_id: session.items[0].session_item_id, client_submission_id: id(), selected_options: ['A'] })
      .expect(404);
    await as(other.token).post(`/sessions/${session.id}/complete`).expect(404);
    await as(other.token).post('/sessions', { enrollment_id: session.enrollment_id, client_session_id: id(), mode: 'quick' }).expect(404);
  });
});

describe('spaced review', () => {
  it('schedules a missed concept for tomorrow in the learner timezone and serves a fresh scenario', async () => {
    const { token } = await guest('Asia/Tokyo');
    const enrollmentId = await enroll(token);
    await completeLesson(token, enrollmentId);
    const reviews = await as(token).get(`/enrollments/${enrollmentId}/reviews`).expect(200);
    expect(reviews.body.due_count).toBe(0);
    expect(reviews.body.missed_count).toBe(2);
    const entry = reviews.body.upcoming[0];
    expect(entry.stage).toBe(0);
    // Local midnight in Tokyo is 15:00 UTC the day before.
    expect(entry.due_at).toMatch(/T15:00:00\.000Z$/);

    await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'review' }).expect(409);
    await ReviewQueue.updateMany({ enrollmentId }, { $set: { dueAt: new Date(Date.now() - 1000) } });
    const review = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'review' }).expect(201);
    // Fresh scenarios come first: the unseen time-travel families in the checkpoint pool.
    expect(review.body.items[0].repeat).toBe(false);
  });

  it('a correct answer on a due concept advances it one stage', async () => {
    const { token } = await guest('Etc/UTC');
    const enrollmentId = await enroll(token);
    await completeLesson(token, enrollmentId);
    await ReviewQueue.updateMany({ enrollmentId }, { $set: { dueAt: new Date(Date.now() - 1000) } });
    const missed = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'missed' }).expect(201);
    expect(missed.body.items).toHaveLength(2);
    const correctPicks = { 'Does table history guarantee that old data is still available?': 'A', 'A team needs a 30-day-old snapshot. What should it check?': 'C' } as Record<string, string>;
    for (const item of missed.body.items) {
      await as(token)
        .post(`/sessions/${missed.body.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), selected_options: [correctPicks[item.prompt]] })
        .expect(200);
    }
    const entry = await ReviewQueue.findOne({ enrollmentId }).lean();
    expect(entry!.stage).toBe(1);
    expect(entry!.history.at(-1)).toMatchObject({ priorStage: 0, correct: true, nextStage: 1 });
    const done = await as(token).post(`/sessions/${missed.body.id}/complete`).expect(200);
    // Two submitted items do not qualify for a study day.
    expect(done.body.study_day_credited).toBe(false);
  });
});

describe('streak credit across days', () => {
  it('extends the streak when yesterday was credited and restarts after a gap', async () => {
    const { token, userId } = await guest('Etc/UTC');
    const enrollmentId = await enroll(token);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await StreakState.updateOne({ _id: userId }, { $set: { currentDays: 6, longestDays: 6, lastStudyDate: yesterday } }, { upsert: true });
    const done = await completeLesson(token, enrollmentId);
    expect(done.current_streak).toBe(7);

    const other = await guest('Etc/UTC');
    const otherEnrollment = await enroll(other.token);
    await StreakState.updateOne({ _id: other.userId }, { $set: { currentDays: 6, longestDays: 9, lastStudyDate: '2026-01-01' } }, { upsert: true });
    const restarted = await completeLesson(other.token, otherEnrollment);
    expect(restarted.current_streak).toBe(1);
    expect((await StreakState.findById(other.userId).lean())!.longestDays).toBe(9);
  });
});

describe('progress', () => {
  it('reports denominators and keeps first-seen and repeat accuracy separate', async () => {
    const { token } = await guest();
    const enrollmentId = await enroll(token);
    const first = await completeLesson(token, enrollmentId);
    await completeLesson(token, enrollmentId, first.lesson_id);
    const progress = await as(token).get(`/enrollments/${enrollmentId}/progress`).expect(200);
    expect(progress.body).toMatchObject({ first_seen_correct: 3, first_seen_total: 5, repeat_correct: 3, repeat_total: 5, practiced_objectives: 2, total_objectives: 16 });
    expect(progress.body.note).toMatch(/not a pass prediction/i);
    expect(JSON.stringify(progress.body)).not.toMatch(/probab/i);
    // No objective has five first-seen answers yet, so the focus is a coverage gap, not an accuracy ranking.
    expect(progress.body.focus.reason).toBe('coverage_gap');
    const enough = progress.body.domains.filter((d: { enough_practice: boolean }) => d.enough_practice);
    expect(enough.map((d: { title: string }) => d.title)).toEqual(['Data transformation and modeling']);
  });
});
