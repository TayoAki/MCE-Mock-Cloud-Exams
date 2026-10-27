import { describe, expect, it } from 'vitest';
import { Attempt, Celebration, Domain, GemLedger, PracticeSession, QotdStreak, QuestionFamily } from '../src/models/index.js';
import { addDays } from '../src/lib/time.js';
import { SEED_DIFFICULTY } from '../src/seed/difficulty.js';
import { as, completeLesson, enroll, guest, id, pilotVersionId, playSession, registered, startLesson } from './helpers.js';

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
