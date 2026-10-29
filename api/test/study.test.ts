import { describe, expect, it } from 'vitest';
import { Attempt, Celebration, Domain, GemLedger, PracticeSession, QotdStreak, QuestionFamily, QuestionVersion } from '../src/models/index.js';
import { addDays } from '../src/lib/time.js';
import { SEED_DIFFICULTY } from '../src/seed/difficulty.js';
import { admin, as, completeLesson, correctBody, enroll, guest, id, pilotVersionId, playSession, registered, startLesson, wrongBody } from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

async function learner() {
  const { token, userId } = await guest('Etc/UTC');
  const enrollmentId = await enroll(token);
  return { token, userId, enrollmentId };
}

/** A learner with the Plus preview, so Level Up can draw on the whole bank (tests run with Plus gating on). */
async function plusLearner() {
  const { token, userId } = await registered('Etc/UTC');
  const enrollmentId = await enroll(token);
  await as(token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(201);
  return { token, userId, enrollmentId };
}

const start = (token: string, body: Record<string, unknown>) => as(token).post('/sessions', { client_session_id: id(), ...body });

describe('Question of the Day', () => {
  it('gives every learner the same question, once a day, with its own streak and gems', async () => {
    const a = await learner();
    const b = await learner();
    const viewA = (await as(a.token).get(`/enrollments/${a.enrollmentId}/qotd`).expect(200)).body;
    expect(viewA).toMatchObject({ date: today(), available: true, status: 'new', session_id: null, streak: { current: 0, answered_today: false } });
    expect(viewA.question.prompt).toBeTruthy();

    const sa = (await start(a.token, { enrollment_id: a.enrollmentId, mode: 'qotd' }).expect(201)).body;
    const sb = (await start(b.token, { enrollment_id: b.enrollmentId, mode: 'qotd' }).expect(201)).body;
    expect(sa.items).toHaveLength(1);
    expect(sa.qotd_date).toBe(today());
    expect(sb.items[0].question_version_id).toBe(sa.items[0].question_version_id);
    expect(['single', 'multiple']).toContain(sa.items[0].answer_type);
    // Opening it again resumes the same session.
    const again = (await start(a.token, { enrollment_id: a.enrollmentId, mode: 'qotd' }).expect(201)).body;
    expect(again.id).toBe(sa.id);
    expect((await as(a.token).get(`/enrollments/${a.enrollmentId}/qotd`)).body.status).toBe('in_progress');

    const { completion } = await playSession(a.token, sa);
    expect(completion.qotd).toEqual({ date: today(), correct: true, streak: 1, longest: 1 });
    // One question is not a study day; the QotD streak is separate.
    expect(completion.study_day_credited).toBe(false);
    expect(await GemLedger.countDocuments({ userId: a.userId, reason: 'qotd' })).toBe(1);
    await start(a.token, { enrollment_id: a.enrollmentId, mode: 'qotd' }).expect(409, /qotd_done/);
    const done = (await as(a.token).get(`/enrollments/${a.enrollmentId}/qotd`).expect(200)).body;
    expect(done).toMatchObject({ status: 'done', session_id: sa.id, result: { correct: true }, streak: { current: 1, answered_today: true } });
  });

  it('continues the streak from yesterday, restarts after a gap, and awards the 7-day badge', async () => {
    const a = await learner();
    await QotdStreak.create({ _id: a.userId, currentDays: 6, longestDays: 6, lastDate: addDays(today(), -1) });
    const shown = (await as(a.token).get(`/enrollments/${a.enrollmentId}/qotd`)).body;
    expect(shown.streak).toMatchObject({ current: 6, answered_today: false });
    const s = (await start(a.token, { enrollment_id: a.enrollmentId, mode: 'qotd' }).expect(201)).body;
    const { completion } = await playSession(a.token, s, () => false);
    expect(completion.qotd).toMatchObject({ correct: false, streak: 7, longest: 7 });
    expect(completion.engagement.celebrations.some((c: { payload: { key?: string } }) => c.payload.key === 'qotd_7')).toBe(true);

    const b = await learner();
    await QotdStreak.create({ _id: b.userId, currentDays: 4, longestDays: 9, lastDate: addDays(today(), -3) });
    expect((await as(b.token).get(`/enrollments/${b.enrollmentId}/qotd`)).body.streak.current).toBe(0);
    const sb = (await start(b.token, { enrollment_id: b.enrollmentId, mode: 'qotd' }).expect(201)).body;
    expect((await playSession(b.token, sb)).completion.qotd).toMatchObject({ streak: 1, longest: 9 });
  });
});

describe('peer accuracy', () => {
  it('shows the share of learners right on their first try, once five have answered', async () => {
    const first = await learner();
    const s = (await start(first.token, { enrollment_id: first.enrollmentId, mode: 'qotd' }).expect(201)).body;
    const familyId = s.items[0].family_id;
    const answered = async () => Attempt.countDocuments({ familyId, firstSeenFamily: true, invalidatedAt: null });
    const { receipts } = await playSession(first.token, s);
    expect(receipts[0].peer.answered).toBe(await answered());

    // Fill up to at least five first tries, alternating right and wrong.
    let n = 0;
    while ((await answered()) < 6) {
      const l = await learner();
      const sl = (await start(l.token, { enrollment_id: l.enrollmentId, mode: 'qotd' }).expect(201)).body;
      await playSession(l.token, sl, () => n++ % 2 === 0);
    }
    const total = await answered();
    const correct = await Attempt.countDocuments({ familyId, firstSeenFamily: true, invalidatedAt: null, isCorrect: true });
    const view = (await as(first.token).get(`/sessions/${s.id}`).expect(200)).body;
    expect(view.items[0].submission.peer).toEqual({ answered: total, correct_percent: Math.round((correct / total) * 100) });
    const qotd = (await as(first.token).get(`/enrollments/${first.enrollmentId}/qotd`)).body;
    expect(qotd.result.peer.correct_percent).toBe(Math.round((correct / total) * 100));
  });

  it('withholds the percentage below five learners', async () => {
    const l = await learner();
    const session = await startLesson(l.token, l.enrollmentId);
    // Unanswered items carry no submission; answered ones show peer data with the feedback.
    const { receipts } = await playSession(l.token, session);
    for (const r of receipts) {
      expect(r.peer).toHaveProperty('answered');
      if (r.peer.answered < 5) expect(r.peer.correct_percent).toBeNull();
    }
  });
});

describe('suggested next step', () => {
  it('offers to retry this session’s misses, and that quiz holds exactly those questions', async () => {
    const l = await learner();
    const session = await startLesson(l.token, l.enrollmentId);
    await as(l.token).get(`/sessions/${session.id}/next`).expect(409, /not_finalized/);
    const missed = new Set([1, 4]);
    await playSession(l.token, session, (i) => !missed.has(i));

    const next = (await as(l.token).get(`/sessions/${session.id}/next`).expect(200)).body;
    expect(next.primary).toMatchObject({ kind: 'retry_missed', title: 'Retry the 2 you missed', start: { mode: 'missed', source_session_id: session.id } });
    // Misses come back for review tomorrow, so today's question is the alternative.
    expect(next.secondary.kind).toBe('qotd');

    const retry = (await start(l.token, { enrollment_id: l.enrollmentId, ...next.primary.start }).expect(201)).body;
    expect(retry.items.map((i: { family_id: string }) => i.family_id).sort()).toEqual([session.items[1].family_id, session.items[4].family_id].sort());
  });

  it('points to the next lesson after a clean lesson, and suggests a break on a long day', async () => {
    const l = await learner();
    const session = await startLesson(l.token, l.enrollmentId);
    await playSession(l.token, session);
    const next = (await as(l.token).get(`/sessions/${session.id}/next`).expect(200)).body;
    expect(['qotd', 'next_lesson']).toContain(next.primary.kind);
    expect([next.primary.kind, next.secondary.kind]).toContain('next_lesson');
    const lesson = [next.primary, next.secondary].find((s: { kind: string }) => s.kind === 'next_lesson');
    expect(lesson.start.mode).toBe('lesson');
    expect(lesson.start.lesson_id).not.toBe(session.lesson?.id);

    // Four more 10-minute sessions today make a long day.
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      await PracticeSession.create({
        userId: l.userId,
        enrollmentId: l.enrollmentId,
        examVersionId: await pilotVersionId(),
        mode: 'quick',
        status: 'completed',
        questionCount: 5,
        clientSessionId: id(),
        items: [],
        startedAt: new Date(now - (i + 1) * 600_000),
        completedAt: new Date(now - i * 600_000 - 1),
      });
    }
    const tired = (await as(l.token).get(`/sessions/${session.id}/next`).expect(200)).body;
    expect(tired.primary).toMatchObject({ kind: 'take_break', start: null });
    expect(tired.secondary.kind).not.toBe('take_break');
  });
});

describe('flagged questions', () => {
  it('flags a seen question, shows it in the session and the list, and quizzes on it', async () => {
    const l = await learner();
    await as(l.token).post('/sessions', { enrollment_id: l.enrollmentId, client_session_id: id(), mode: 'flagged' }).expect(409, /nothing_flagged/);
    const session = await startLesson(l.token, l.enrollmentId);
    const [one, two] = session.items;
    await as(l.token).put(`/flags/${one.family_id}`, { question_version_id: one.question_version_id }).expect(200, { family_id: one.family_id, flagged: true });
    // Idempotent.
    await as(l.token).put(`/flags/${one.family_id}`, { question_version_id: one.question_version_id }).expect(200);
    await as(l.token).put(`/flags/${two.family_id}`, { question_version_id: two.question_version_id }).expect(200);
    // A mismatched family, or a question the learner was never shown, is not found.
    await as(l.token).put(`/flags/${two.family_id}`, { question_version_id: one.question_version_id }).expect(404);
    const other = await learner();
    await as(other.token).put(`/flags/${one.family_id}`, { question_version_id: one.question_version_id }).expect(404);

    const view = (await as(l.token).get(`/sessions/${session.id}`).expect(200)).body;
    expect(view.items.map((i: { flagged: boolean }) => i.flagged)).toEqual([true, true, false, false, false]);
    await playSession(l.token, session, (i) => i !== 0);

    const list = (await as(l.token).get(`/enrollments/${l.enrollmentId}/flags`).expect(200)).body;
    expect(list.quiz_available).toBe(2);
    expect(list.items.find((i: { family_id: string }) => i.family_id === one.family_id)).toMatchObject({ last_correct: false, available: true, prompt: one.prompt });

    const quiz = (await start(l.token, { enrollment_id: l.enrollmentId, mode: 'flagged' }).expect(201)).body;
    expect(quiz.items.map((i: { family_id: string }) => i.family_id).sort()).toEqual([one.family_id, two.family_id].sort());
    expect(quiz.items.every((i: { flagged: boolean }) => i.flagged)).toBe(true);

    await as(l.token).delete(`/flags/${one.family_id}`).expect(200, { family_id: one.family_id, flagged: false });
    expect((await as(l.token).get(`/enrollments/${l.enrollmentId}/flags`)).body.items).toHaveLength(1);
  });
});

describe('Level Up', () => {
  it('labels every seed question with a difficulty, with each level present in every domain', async () => {
    const examVersionId = await pilotVersionId();
    const families = await QuestionFamily.find({ examVersionId, familyKey: { $in: Object.keys(SEED_DIFFICULTY) } }).lean();
    expect(families).toHaveLength(Object.keys(SEED_DIFFICULTY).length);
    for (const f of families) expect(f.difficulty).toBe(SEED_DIFFICULTY[f.familyKey]);
    const l = await plusLearner();
    const overview = (await as(l.token).get(`/enrollments/${l.enrollmentId}/level-up`).expect(200)).body;
    expect(overview.levels.map((x: { label: string }) => x.label)).toEqual(['Foundations', 'Applied', 'Advanced', 'Mastery']);
    for (const d of overview.domains) {
      expect(d).toMatchObject({ level_passed: 0, current_level: 1, label: 'Foundations', mastered: false, available: true, locked: false });
      expect(d.by_difficulty.every((n: number) => n > 0)).toBe(true);
    }
  });

  it('opens a domain on the free plan only once the path reaches it', async () => {
    const l = await learner();
    const overview = (await as(l.token).get(`/enrollments/${l.enrollmentId}/level-up`).expect(200)).body;
    const jobs = overview.domains.find((d: { title: string }) => d.title === 'Working with Lakeflow Jobs');
    expect(jobs).toMatchObject({ available: false, locked: true, question_count: 0 });
    await start(l.token, { enrollment_id: l.enrollmentId, mode: 'levelup', domain_ids: [jobs.domain_id] }).expect(409, /levelup_locked/);
    const transformation = overview.domains.find((d: { title: string }) => d.title === 'Data transformation and modeling');
    expect(transformation).toMatchObject({ available: true, locked: false });
  });

  it('raises difficulty one level at a time in one domain, needing 4 of 5 to pass', async () => {
    const l = await plusLearner();
    const domain = (await Domain.findOne({ examVersionId: await pilotVersionId(), title: 'Data transformation and modeling' }).lean())!;
    await start(l.token, { enrollment_id: l.enrollmentId, mode: 'levelup' }).expect(400, /domain_required/);

    const difficulties = async (items: { family_id: string }[]) =>
      (await QuestionFamily.find({ _id: { $in: items.map((i) => i.family_id) } }).lean()).map((f) => f.difficulty);

    const one = (await start(l.token, { enrollment_id: l.enrollmentId, mode: 'levelup', domain_ids: [domain._id] }).expect(201)).body;
    expect(one.level_up).toMatchObject({ level: 1, label: 'Foundations', pass_needed: 4 });
    expect(one.items).toHaveLength(5);
    expect(one.items.every((i: { domain_title: string }) => i.domain_title === domain.title)).toBe(true);
    expect(await difficulties(one.items)).toEqual([1, 1, 1, 1, 1]);
    const passed = (await playSession(l.token, one, (i) => i !== 2)).completion;
    expect(passed.level_up).toMatchObject({ level: 1, passed: true, newly_passed: true, correct: 4, needed: 4, next_level: { level: 2, label: 'Applied' } });
    expect(passed.engagement.celebrations.map((c: { kind: string }) => c.kind)).toContain('levelup_passed');
    expect(await Celebration.countDocuments({ userId: l.userId, kind: 'levelup_passed' })).toBe(1);

    const two = (await start(l.token, { enrollment_id: l.enrollmentId, mode: 'levelup', domain_ids: [domain._id] }).expect(201)).body;
    expect(two.level_up.level).toBe(2);
    expect(await difficulties(two.items)).toEqual([2, 2, 2, 2, 2]);
    const failed = (await playSession(l.token, two, (i) => i < 3)).completion;
    expect(failed.level_up).toMatchObject({ level: 2, passed: false, newly_passed: false, correct: 3, next_level: { level: 2 } });
    const next = (await as(l.token).get(`/sessions/${two.id}/next`).expect(200)).body;
    expect(next.primary).toMatchObject({ kind: 'level_up', title: 'Try Level 2 again', start: { mode: 'levelup', domain_ids: [domain._id] } });

    const overview = (await as(l.token).get(`/enrollments/${l.enrollmentId}/level-up`)).body;
    expect(overview.domains.find((d: { domain_id: string }) => d.domain_id === domain._id)).toMatchObject({
      level_passed: 1,
      current_level: 2,
      label: 'Applied',
      attempts: 2,
      best: { 1: 4, 2: 3 },
    });
  });

  it('fills a small domain from the nearest difficulty and reaches Mastery', async () => {
    const l = await plusLearner();
    // Lakeflow Jobs has 2 easy, 2 medium and 1 hard question.
    const domain = (await Domain.findOne({ examVersionId: await pilotVersionId(), title: 'Working with Lakeflow Jobs' }).lean())!;
    let mastered = false;
    for (let level = 1; level <= 4; level++) {
      const s = (await start(l.token, { enrollment_id: l.enrollmentId, mode: 'levelup', domain_ids: [domain._id] }).expect(201)).body;
      expect(s.level_up.level).toBe(level);
      const { completion } = await playSession(l.token, s);
      expect(completion.level_up.passed).toBe(true);
      mastered = completion.level_up.mastered;
    }
    expect(mastered).toBe(true);
    const overview = (await as(l.token).get(`/enrollments/${l.enrollmentId}/level-up`)).body;
    expect(overview.domains.find((d: { domain_id: string }) => d.domain_id === domain._id)).toMatchObject({ level_passed: 4, mastered: true, label: 'Mastery' });
    const badges = (await as(l.token).get('/me/achievements').expect(200)).body.badges;
    expect(badges.find((b: { key: string }) => b.key === 'levelup_mastery').earned_at).toBeTruthy();
  });
});

describe('lesson flow still works', () => {
  it('completes a lesson with the new session fields present', async () => {
    const l = await learner();
    const completion = await completeLesson(l.token, l.enrollmentId);
    expect(completion.level_up).toBeNull();
    expect(completion.qotd).toBeNull();
  });
});

describe('question ratings', () => {
  it('lets a learner rate a question once its answer is shown, and shows the average once five have rated', async () => {
    const raters = await Promise.all([1, 2, 3, 4, 5].map(() => learner()));
    const [first] = raters;
    const session = await startLesson(first!.token, first!.enrollmentId);
    const item = session.items[0];
    const rate = (token: string, stars: number, versionId = item.question_version_id) =>
      as(token).put(`/ratings/${item.family_id}`, { question_version_id: versionId, stars });

    // Not before answering, not out of range, and only for the family's own revision.
    await rate(first!.token, 4).expect(400, /not_answered/);
    const receipt = (await as(first!.token).post(`/sessions/${session.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), ...(await correctBody(item)) }).expect(200)).body;
    expect(receipt.rating).toEqual({ mine: null, average: null, count: 0 });
    await rate(first!.token, 6).expect(400);
    await rate(first!.token, 4, session.items[1].question_version_id).expect(404);

    expect((await rate(first!.token, 4).expect(200)).body).toEqual({ family_id: item.family_id, mine: 4, average: null, count: 1 });
    // Rating again replaces the stars rather than adding a rating.
    expect((await rate(first!.token, 2).expect(200)).body).toMatchObject({ mine: 2, count: 1 });
    const view = (await as(first!.token).get(`/sessions/${session.id}`).expect(200)).body;
    expect(view.items[0].submission.rating).toEqual({ mine: 2, average: null, count: 1 });
    expect(view.items[1].submission).toBeNull();

    for (const [i, r] of raters.slice(1).entries()) {
      const s = await startLesson(r.token, r.enrollmentId);
      await as(r.token).post(`/sessions/${s.id}/answers`, { session_item_id: s.items[0].session_item_id, client_submission_id: id(), ...(await wrongBody(s.items[0])) }).expect(200);
      await rate(r.token, [5, 4, 4, 3][i]!).expect(200);
    }
    // (2 + 5 + 4 + 4 + 3) / 5 = 3.6, shown now that five learners rated.
    expect((await rate(first!.token, 2).expect(200)).body).toMatchObject({ mine: 2, average: 3.6, count: 5 });

    expect((await as(first!.token).delete(`/ratings/${item.family_id}`).expect(200)).body).toEqual({ family_id: item.family_id, mine: null, average: null, count: 4 });
  });

  it('waits for a mock to be submitted before its questions can be rated', async () => {
    const l = await learner();
    const mock = (await start(l.token, { enrollment_id: l.enrollmentId, mode: 'mock', question_count: 10 }).expect(201)).body;
    const item = mock.items[0];
    const receipt = (await as(l.token).post(`/sessions/${mock.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), selected_options: ['A'] }).expect(200)).body;
    expect(receipt.rating).toBeNull();
    await as(l.token).put(`/ratings/${item.family_id}`, { question_version_id: item.question_version_id, stars: 3 }).expect(400, /not_answered/);
    await as(l.token).post(`/sessions/${mock.id}/complete`).expect(200);
    await as(l.token).put(`/ratings/${item.family_id}`, { question_version_id: item.question_version_id, stars: 3 }).expect(200);
    const review = (await as(l.token).get(`/sessions/${mock.id}/feedback`).expect(200)).body;
    expect(review.items.find((i: { family_id: string }) => i.family_id === item.family_id).rating).toMatchObject({ mine: 3, count: 1 });
  });

  it('puts poorly rated questions in front of staff', async () => {
    const examVersionId = await pilotVersionId();
    const raters = await Promise.all([1, 2, 3].map(() => learner()));
    let target: { family_id: string; question_version_id: string } | undefined;
    for (const r of raters) {
      const s = await startLesson(r.token, r.enrollmentId);
      const item = s.items[2];
      target = item;
      await as(r.token).post(`/sessions/${s.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), ...(await correctBody(item)) }).expect(200);
      await as(r.token).put(`/ratings/${item.family_id}`, { question_version_id: item.question_version_id, stars: 1 }).expect(200);
    }
    const { token } = await admin();
    const low = (await as(token).get(`/admin/questions?exam_version_id=${examVersionId}&low_rated=true`).expect(200)).body.questions;
    expect(low.map((q: { family_id: string }) => q.family_id)).toContain(target!.family_id);
    expect(low.every((q: { rating_average: number; rating_count: number }) => q.rating_average <= 2.5 && q.rating_count >= 3)).toBe(true);
    const sorted = (await as(token).get(`/admin/questions?exam_version_id=${examVersionId}&status=published&sort=lowest_rated`).expect(200)).body.questions;
    expect(sorted[0]).toMatchObject({ rating_average: 1, rating_count: 3 });
    // Every published question is listed, not just the first 500.
    expect(sorted.length).toBe(await QuestionVersion.countDocuments({ examVersionId, status: 'published' }));
    const detail = (await as(token).get(`/admin/questions/${target!.question_version_id}`).expect(200)).body;
    expect(detail.ratings).toEqual({ average: 1, count: 3, distribution: [3, 0, 0, 0, 0], this_revision: 3 });
    expect((await as(token).get('/admin/overview').expect(200)).body.low_rated_questions).toBeGreaterThanOrEqual(1);
  });
});
