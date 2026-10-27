import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { Domain, Entitlement, PracticeSession, QuestionVersion, RewardLedger } from '../src/models/index.js';
import { expireOverdueSessions } from '../src/services/completion.js';
import { as, enroll, guest, id, pilotVersionId, registered } from './helpers.js';

async function startSample(token: string, enrollmentId: string) {
  return (await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock', question_count: 10 }).expect(201)).body;
}

describe('mock exams', () => {
  it('blueprint-balances a sample and withholds feedback until submission', async () => {
    const { token } = await guest();
    const enrollmentId = await enroll(token);
    const mock = await startSample(token, enrollmentId);
    expect(mock.items).toHaveLength(10);
    expect(mock.sample).toBe(true);
    expect(mock.feedback_timing).toBe('after_submit');
    expect(new Date(mock.deadline_at).getTime() - new Date(mock.started_at).getTime()).toBe(20 * 60_000);

    const answer = await as(token)
      .post(`/sessions/${mock.id}/answers`, { session_item_id: mock.items[0].session_item_id, client_submission_id: id(), selected_options: ['A'] })
      .expect(200);
    expect(answer.body.feedback).toBeNull();
    const view = await as(token).get(`/sessions/${mock.id}`).expect(200);
    expect(view.body.items[0].submission.feedback).toBeNull();
    await as(token).get(`/sessions/${mock.id}/feedback`).expect(409);
    await as(token).get(`/sessions/${mock.id}/results`).expect(409);
    await as(token).post(`/sessions/${mock.id}/abandon`).expect(409);

    const done = await as(token).post(`/sessions/${mock.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ mode: 'mock', status: 'completed', total: 10, answered: 1, sample: true, study_day_credited: false });
    expect(done.body.domains.reduce((s: number, d: { total: number }) => s + d.total, 0)).toBe(10);
    const feedback = await as(token).get(`/sessions/${mock.id}/feedback`).expect(200);
    expect(feedback.body.items).toHaveLength(10);
    expect(feedback.body.items.filter((i: { answered: boolean }) => !i.answered).every((i: { feedback: { correct: boolean } }) => !i.feedback.correct)).toBe(true);
    expect((await as(token).get(`/sessions/${mock.id}/results`).expect(200)).body).toEqual(done.body);
  });

  it('the server deadline keeps running: an expired form finalizes once and unanswered items score incorrect', async () => {
    const { token, userId } = await guest();
    const enrollmentId = await enroll(token);
    const mock = await startSample(token, enrollmentId);
    for (const item of mock.items.slice(0, 6)) {
      await as(token).post(`/sessions/${mock.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), selected_options: ['A'] }).expect(200);
    }
    await PracticeSession.updateOne({ _id: mock.id }, { $set: { deadlineAt: new Date(Date.now() - 1000) } });

    const late = await as(token)
      .post(`/sessions/${mock.id}/answers`, { session_item_id: mock.items[7].session_item_id, client_submission_id: id(), selected_options: ['A'] })
      .expect(409);
    expect(late.body.code).toBe('session_expired');
    const [view, worker] = await Promise.all([as(token).get(`/sessions/${mock.id}`), expireOverdueSessions()]);
    expect(view.body.status).toBe('expired');
    expect(worker).toBeLessThanOrEqual(1);
    const results = await as(token).get(`/sessions/${mock.id}/results`).expect(200);
    expect(results.body).toMatchObject({ status: 'expired', answered: 6, total: 10 });
    // Six submitted items qualify for a study day even though the form expired.
    expect(results.body.study_day_credited).toBe(true);
    const xpRows = await RewardLedger.countDocuments({ userId, sessionId: mock.id });
    expect(xpRows).toBeGreaterThanOrEqual(6);
  });

  it('an expired mock with fewer than five answers grants no study day', async () => {
    const { token } = await guest();
    const mock = await startSample(token, await enroll(token));
    await PracticeSession.updateOne({ _id: mock.id }, { $set: { deadlineAt: new Date(Date.now() - 1000) } });
    expect(await expireOverdueSessions()).toBe(1);
    const results = await as(token).get(`/sessions/${mock.id}/results`).expect(200);
    expect(results.body).toMatchObject({ status: 'expired', answered: 0, correct: 0, xp_granted: 0, study_day_credited: false });
  });

  it('free learners get one sample a day; the full form needs Plus and fails cleanly on thin inventory', async () => {
    const { token, userId } = await registered();
    const enrollmentId = await enroll(token);
    await startSample(token, enrollmentId);
    const second = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock', question_count: 5 }).expect(403);
    expect(second.body.code).toBe('plus_required');
    const full = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock' }).expect(403);
    expect(full.body.details.feature).toBe('mocks');

    await as(token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(201);
    // With the full bank, a 45-question form fills from every domain.
    const form = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock' }).expect(201);
    expect(form.body.items).toHaveLength(45);
    await as(token).post(`/sessions/${form.body.id}/complete`).expect(200);

    // Thin inventory (here: only 5 Jobs questions left published) fails cleanly with the shortfall.
    const jobs = (await Domain.findOne({ examVersionId: await pilotVersionId(), code: 'jobs' }).lean())!;
    const jobsQuestions = (await QuestionVersion.find({ domainId: jobs._id, status: 'published', storyId: null }).select({ _id: 1 }).lean()).map((q) => q._id);
    const hidden = jobsQuestions.slice(5);
    await QuestionVersion.updateMany({ _id: { $in: hidden } }, { $set: { status: 'retired' } });
    try {
      const thin = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock' }).expect(409);
      expect(thin.body.code).toBe('insufficient_inventory');
      expect(thin.body.details.shortfall).toEqual([expect.objectContaining({ title: 'Working with Lakeflow Jobs', required: 7, available: 5 })]);
    } finally {
      await QuestionVersion.updateMany({ _id: { $in: hidden } }, { $set: { status: 'published' } });
    }
    await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock', question_count: 10 }).expect(201);
    await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock', question_count: 20 }).expect(400);
    expect(await Entitlement.countDocuments({ userId })).toBe(4);
  });

  it('a learner admitted to a mock can finish it after access ends', async () => {
    const { token, userId } = await registered();
    const enrollmentId = await enroll(token);
    await as(token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(201);
    const timed = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'timed', question_count: 5 }).expect(201);
    const session = await PracticeSession.findById(timed.body.id).lean();
    expect((session!.selectionConfig as { admission: { features: string[] } }).admission.features).toContain('custom_quiz');
    await Entitlement.updateMany({ userId }, { $set: { endsAt: new Date(Date.now() - 1), startsAt: new Date(Date.now() - 86_400_000) } });
    for (const item of timed.body.items) {
      await as(token).post(`/sessions/${timed.body.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), selected_options: ['A'] }).expect(200);
    }
    await as(token).post(`/sessions/${timed.body.id}/complete`).expect(200);
    // New premium sessions need valid access again.
    await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'custom' }).expect(403);
  });
});

describe('plans and access', () => {
  it('the preview needs an account, starts explicitly, lasts 14 days and is used once', async () => {
    const g = await guest();
    expect((await as(g.token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(403)).body.code).toBe('account_required');
    const { token } = await registered();
    await as(token).post('/me/preview', { accept_terms: false, client_request_id: id() }).expect(400);
    const key = id();
    const first = await as(token).post('/me/preview', { accept_terms: true, client_request_id: key }).expect(201);
    expect(first.body).toMatchObject({ renews: false, card_required: false });
    const days = (new Date(first.body.ends_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect((await as(token).post('/me/preview', { accept_terms: true, client_request_id: key }).expect(201)).body).toEqual(first.body);
    expect((await as(token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(409)).body.code).toBe('preview_already_used');
    const me = await as(token).get('/me').expect(200);
    expect(me.body).toMatchObject({ plus_active: true, preview_used: true });
  });

  it('store purchases grant from verified events once and cannot be claimed by another account', async () => {
    const buyer = await registered();
    const token = 'sandbox:certpath.plus.monthly:txn-abc';
    const first = await as(buyer.token).post('/store/verify', { provider: 'apple', signed_transaction: token, client_request_id: id() }).expect(200);
    const again = await as(buyer.token).post('/store/verify', { provider: 'apple', signed_transaction: token, client_request_id: id() }).expect(200);
    expect(first.body.restored).toBe(false);
    expect(again.body.restored).toBe(true);
    const endsAt = (r: { body: { entitlements: { source: string; ends_at: string }[] } }) => r.body.entitlements.find((e) => e.source === 'store')!.ends_at;
    expect(endsAt(again)).toBe(endsAt(first));
    const thief = await registered();
    expect((await as(thief.token).post('/store/verify', { provider: 'apple', signed_transaction: token, client_request_id: id() }).expect(409)).body.code).toBe('receipt_owned_elsewhere');
    expect((await as(buyer.token).post('/store/verify', { provider: 'google', signed_transaction: 'real-token', client_request_id: id() }).expect(501)).body.code).toBe('store_verification_unavailable');
  });

  it('AI help is a Plus feature and falls back to the reviewed explanation', async () => {
    const { token } = await registered();
    const enrollmentId = await enroll(token);
    const session = (await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'quick' }).expect(201)).body;
    const receipt = await as(token)
      .post(`/sessions/${session.id}/answers`, { session_item_id: session.items[0].session_item_id, client_submission_id: id(), selected_options: ['B'] })
      .expect(200);
    expect((await as(token).post('/explanations', { attempt_id: receipt.body.attempt_id, style: 'short' }).expect(403)).body.code).toBe('plus_required');
    await as(token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(201);
    const explained = await as(token).post('/explanations', { attempt_id: receipt.body.attempt_id, style: 'analogy' }).expect(200);
    expect(explained.body.origin).toBe('reviewed_fallback');
    expect(explained.body.text).toBe(receipt.body.feedback.rationale);
    expect(explained.body.sources).toEqual(receipt.body.feedback.sources);
    const other = await registered();
    await as(other.token).post('/explanations', { attempt_id: receipt.body.attempt_id, style: 'short' }).expect(404);
  });

  it('with Plus off, every learner has every feature and nothing is for sale', async () => {
    config.PLUS_ENABLED = false;
    try {
      const { token, userId } = await guest();
      const enrollmentId = await enroll(token);
      const me = await as(token).get('/me').expect(200);
      expect(me.body).toMatchObject({ plus_enabled: false, plus_active: false });
      const practice = await as(token).get(`/enrollments/${enrollmentId}/practice`).expect(200);
      expect(practice.body.features).toEqual(['ai_explain', 'custom_quiz', 'full_bank', 'mocks']);
      // Guests too: no daily sample limit, custom and timed quizzes, AI help.
      await startSample(token, enrollmentId);
      await startSample(token, enrollmentId);
      await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'timed', question_count: 10 }).expect(201);
      const quick = (await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'quick' }).expect(201)).body;
      const receipt = await as(token)
        .post(`/sessions/${quick.id}/answers`, { session_item_id: quick.items[0].session_item_id, client_submission_id: id(), selected_options: ['A'] })
        .expect(200);
      await as(token).post('/explanations', { attempt_id: receipt.body.attempt_id, style: 'short' }).expect(200);

      const { token: account } = await registered();
      expect((await as(account).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(409)).body.code).toBe('plus_unavailable');
      const sale = await as(account).post('/store/verify', { provider: 'apple', signed_transaction: 'sandbox:certpath.plus.monthly:txn-free', client_request_id: id() }).expect(409);
      expect(sale.body.code).toBe('plus_unavailable');
      expect(await Entitlement.countDocuments({ userId })).toBe(0);
    } finally {
      config.PLUS_ENABLED = true;
    }
  });

  it('free quick practice stays within unlocked lessons; Plus opens the full bank', async () => {
    const { token } = await registered();
    const enrollmentId = await enroll(token);
    const quick = (await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'quick' }).expect(201)).body;
    expect(new Set(quick.items.map((i: { objective_title: string }) => i.objective_title))).toEqual(new Set(['Time travel and retained files', 'File cleanup and retention']));
    await as(token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(201);
    const custom = (await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'custom', question_count: 30 }).expect(201)).body;
    expect(custom.items).toHaveLength(30);
    expect(custom.items.every((i: { repeat: boolean }) => !i.repeat)).toBe(true);
  });
});
