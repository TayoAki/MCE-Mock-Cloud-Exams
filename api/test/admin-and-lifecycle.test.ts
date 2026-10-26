import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { Attempt, NotificationJob, ObjectiveProgress, Objective, PracticeSession, QuestionFamily, QuestionVersion, ReviewQueue, User } from '../src/models/index.js';
import { processDeletions } from '../src/services/deletion.js';
import { dispatchReminders, planReminders } from '../src/services/notifications.js';
import { admin, answerAll, as, completeLesson, enroll, guest, id, pilotVersionId, registered, startLesson } from './helpers.js';

const draft = {
  prompt: 'Which command shows the files a Delta table version references?',
  answer_type: 'single',
  options: [
    { key: 'A', text: 'DESCRIBE DETAIL' },
    { key: 'B', text: 'SHOW GRANTS' },
  ],
  correct_options: ['A'],
  rationale: 'Draft rationale for a test question.',
  source_url: 'https://docs.databricks.com/aws/en/delta/',
};

describe('content backoffice', () => {
  it('is staff only', async () => {
    const learner = await guest();
    await as(learner.token).get('/admin/overview').expect(403);
    await as().get('/admin/overview').expect(401);
    const staff = await admin();
    const overview = await as(staff.token).get('/admin/overview').expect(200);
    expect(overview.body.questions_by_status.published).toBe(60);
  });

  it('runs draft → review → publish, keeps revisions immutable and retires superseded ones', async () => {
    const { token } = await admin();
    const versionId = await pilotVersionId();
    const objective = await Objective.findOne({ code: 'transformation.time-travel' }).lean();

    const invalid = await as(token).post('/admin/questions', { ...draft, correct_options: ['A', 'B'], exam_version_id: versionId, objective_id: objective!._id, family_key: 'detail-files' }).expect(400);
    expect(invalid.body.code).toBe('question_invalid');

    const created = await as(token).post('/admin/questions', { ...draft, exam_version_id: versionId, objective_id: objective!._id, family_key: 'detail-files' }).expect(201);
    const qid = created.body.id;
    expect(created.body).toMatchObject({ status: 'draft', reviewed: false, revision: 1 });
    expect((await as(token).post(`/admin/questions/${qid}/publish`).expect(409)).body.code).toBe('review_required');

    await as(token).post(`/admin/questions/${qid}/review`, { note: 'Checked against docs' }).expect(200);
    // Editing a reviewed draft clears the review.
    const edited = await as(token).put(`/admin/questions/${qid}`, { ...draft, rationale: 'Better rationale.' }).expect(200);
    expect(edited.body.reviewed).toBe(false);
    await as(token).post(`/admin/questions/${qid}/review`, {}).expect(200);
    const published = await as(token).post(`/admin/questions/${qid}/publish`).expect(200);
    expect(published.body.status).toBe('published');
    expect(published.body.audit.map((a: { action: string }) => a.action)).toEqual(['published', 'reviewed', 'edited', 'reviewed', 'created']);

    expect((await as(token).put(`/admin/questions/${qid}`, draft).expect(409)).body.code).toBe('question_immutable');
    const rev2 = await as(token).post(`/admin/questions/${qid}/revisions`, { ...draft, prompt: 'Which command describes the current Delta table, including its location?' }).expect(201);
    expect(rev2.body.revision).toBe(2);
    await as(token).post(`/admin/questions/${qid}/revisions`, draft).expect(409);
    await as(token).post(`/admin/questions/${rev2.body.id}/review`, {}).expect(200);
    await as(token).post(`/admin/questions/${rev2.body.id}/publish`).expect(200);
    expect((await QuestionVersion.findById(qid).lean())!.status).toBe('retired');

    const list = await as(token).get(`/admin/questions?exam_version_id=${versionId}&status=published&q=current Delta table`).expect(200);
    expect(list.body.questions).toHaveLength(1);
  });

  it('retiring with invalidation repairs learner aggregates and is audited', async () => {
    const staff = await admin();
    const learner = await guest();
    const enrollmentId = await enroll(learner.token);
    // Use the second lesson so other tests in this file keep a five-question first lesson.
    await completeLesson(learner.token, enrollmentId);
    const session = await startLesson(learner.token, enrollmentId);
    expect(session.lesson.title).toBe('Cleanup');
    await answerAll(learner.token, session);
    const target = session.items[0].question_version_id;
    const objectiveId = (await QuestionVersion.findById(target).lean())!.objectiveId;
    const before = await ObjectiveProgress.findOne({ enrollmentId, objectiveId }).lean();

    const retired = await as(staff.token).post(`/admin/questions/${target}/retire`, { note: 'Ambiguous wording', invalidate_attempts: true }).expect(200);
    expect(retired.body.repaired_enrollments).toBe(1);
    const after = await ObjectiveProgress.findOne({ enrollmentId, objectiveId }).lean();
    expect(after!.totalAttempts).toBe(before!.totalAttempts - 1);
    expect(await Attempt.countDocuments({ questionVersionId: target, invalidatedAt: { $ne: null } })).toBe(1);
    const audit = await as(staff.token).get(`/admin/audit?entity_id=${target}`).expect(200);
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toContain('attempts_invalidated');
  });

  it('learner issue reports reach the staff queue', async () => {
    const staff = await admin();
    const learner = await guest();
    const session = await startLesson(learner.token, await enroll(learner.token));
    const qv = session.items[2].question_version_id;
    const family = await QuestionFamily.findOne({ familyKey: 'git-pull' }).lean();
    const unseen = await QuestionVersion.findOne({ familyId: family!._id }).lean();
    await as(learner.token).post('/issue-reports', { question_version_id: unseen!._id, reason: 'typo' }).expect(404);
    await as(learner.token).post('/issue-reports', { question_version_id: qv, reason: 'unclear', note: 'Two options look right' }).expect(201);
    const issues = await as(staff.token).get('/admin/issues?status=open').expect(200);
    const issue = issues.body.issues.find((i: { question_version_id: string }) => i.question_version_id === qv);
    expect(issue).toMatchObject({ reason: 'unclear', status: 'open' });
    await as(staff.token).patch(`/admin/issues/${issue.id}`, { status: 'resolved', resolution: 'Clarified in revision 2' }).expect(200);
  });

  it('reports exam-version readiness and blocks publishing an incomplete draft', async () => {
    const { token } = await admin();
    const exams = await as(token).get('/admin/exams').expect(200);
    const aws = exams.body.exams.find((e: { title: string }) => e.title === 'AWS');
    const version = await as(token)
      .post(`/admin/exams/${aws.id}/versions`, { version_label: 'draft-1', effective_from: '2027-01-01', question_count: 65, duration_minutes: 130, guide_url: 'https://aws.amazon.com/certification/' })
      .expect(201);
    await as(token).post(`/admin/exam-versions/${version.body.id}/domains`, { code: 'd1', title: 'Domain one', weight_percent: 60, sort_order: 1 }).expect(200);
    const blocked = await as(token).post(`/admin/exam-versions/${version.body.id}/publish`).expect(409);
    expect(blocked.body.details.checks.find((c: { key: string }) => c.key === 'weights_total_100').ok).toBe(false);
    const domainId = (await as(token).get(`/admin/exam-versions/${version.body.id}`).expect(200)).body.domains[0].id;
    await as(token).delete(`/admin/exam-versions/${version.body.id}/domains/${domainId}`).expect(200);
    const pilotDomain = (await as(token).get(`/admin/exam-versions/${await pilotVersionId()}`).expect(200)).body.domains[0].id;
    // Published blueprints are immutable.
    expect((await as(token).delete(`/admin/exam-versions/${await pilotVersionId()}/domains/${pilotDomain}`).expect(409)).body.code).toBe('version_locked');
    const pilot = await as(token).get(`/admin/exam-versions/${await pilotVersionId()}`).expect(200);
    expect(pilot.body.readiness.ready).toBe(true);
    expect(pilot.body.readiness.checks.find((c: { key: string }) => c.key === 'full_mock_inventory').ok).toBe(false);
  });
});

describe('staff accounts', () => {
  it('only admins create staff, and new reviewers can sign in to the backoffice', async () => {
    const { token } = await admin();
    const email = `reviewer-${id()}@example.com`;
    const created = await as(token).post('/admin/staff', { email, display_name: 'Rae Reviewer', password: 'a strong password!' }).expect(201);
    expect(created.body).toMatchObject({ email, roles: ['reviewer'] });
    const reviewer = await as().post('/auth/login', { email, password: 'a strong password!' }).expect(200);
    await as(reviewer.body.token).get('/admin/questions?exam_version_id=' + (await pilotVersionId())).expect(200);
    await as(reviewer.body.token).post('/admin/staff', { email: `x-${id()}@example.com`, display_name: 'X', password: 'a strong password!' }).expect(403);
    const staff = await as(token).get('/admin/staff').expect(200);
    expect(staff.body.staff.map((s: { email: string }) => s.email)).toContain(email);
  });
});

describe('outcomes, timezone, reminders and deletion', () => {
  it('records a self-reported pass, pauses the enrollment and keeps verification separate', async () => {
    const staff = await admin();
    const { token } = await registered();
    const enrollmentId = await enroll(token);
    const outcome = await as(token)
      .post('/exam-outcomes', { enrollment_id: enrollmentId, result: 'passed', taken_at: new Date().toISOString(), pause_reminders: true, client_request_id: id() })
      .expect(201);
    expect(outcome.body.verification_status).toBe('self_reported');
    const enrollments = await as(token).get('/enrollments').expect(200);
    expect(enrollments.body.enrollments[0].status).toBe('passed');
    const verified = await as(staff.token).patch(`/admin/outcomes/${outcome.body.id}`, { verification_status: 'verified' }).expect(200);
    expect(verified.body.verification_status).toBe('verified');
  });

  it('applies timezone changes from the next local midnight once a learner has study credits', async () => {
    const fresh = await guest('America/New_York');
    const immediate = await as(fresh.token).patch('/me/preferences', { timezone: 'Europe/Paris' }).expect(200);
    expect(immediate.body.user).toMatchObject({ timezone: 'Europe/Paris', pending_timezone: null });
    await as(fresh.token).patch('/me/preferences', { timezone: 'Mars/Olympus' }).expect(400);

    const { token } = await guest('America/New_York');
    await completeLesson(token, await enroll(token));
    const pending = await as(token).patch('/me/preferences', { timezone: 'Asia/Tokyo' }).expect(200);
    expect(pending.body.user.timezone).toBe('America/New_York');
    expect(pending.body.user.pending_timezone.zone).toBe('Asia/Tokyo');
    expect((await as(token).patch('/me/preferences', { timezone: 'Europe/Paris' }).expect(429)).body.code).toBe('timezone_change_limited');
  });

  it('plans one opted-in reminder per local day and suppresses it once the learner studies', async () => {
    const { token, userId } = await guest('Etc/UTC');
    const enrollmentId = await enroll(token);
    await as(token).patch('/me/preferences', { reminders_enabled: true, daily_local_time: '23:59', quiet_start: '00:00', quiet_end: '00:00' }).expect(200);
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    await planReminders(now);
    await planReminders(now);
    expect(await NotificationJob.countDocuments({ userId })).toBe(1);
    const done = await completeLesson(token, enrollmentId);
    expect(done.study_day_credited).toBe(true);
    const job = await NotificationJob.findOne({ userId }).lean();
    const today = new Date().toISOString().slice(0, 10);
    // Completing qualifying study cancels today's queued reminder in the same transaction.
    if (job!.studyDate === today) expect(job).toMatchObject({ status: 'cancelled', reason: 'studied' });
    await NotificationJob.updateMany({ userId }, { $set: { status: 'queued', scheduledAt: new Date(Date.now() - 1000), studyDate: today } });
    await dispatchReminders();
    expect((await NotificationJob.findOne({ userId }).lean())!).toMatchObject({ status: 'cancelled', reason: 'studied' });
  });

  it('a deletion request signs out everywhere and the worker removes learning data', async () => {
    const { token, userId } = await registered();
    await completeLesson(token, await enroll(token));
    const res = await as(token).post('/me/deletion-request').expect(202);
    expect(res.body.status).toBe('queued');
    await as(token).get('/me').expect(401);
    const graceDays = config.DELETION_GRACE_DAYS;
    await User.updateOne({ _id: userId }, { $set: { deletionRequestedAt: new Date(Date.now() - (graceDays + 1) * 86_400_000) } });
    expect(await processDeletions()).toBe(1);
    expect(await PracticeSession.countDocuments({ userId })).toBe(0);
    expect(await ReviewQueue.countDocuments({ userId })).toBe(0);
    const user = await User.findById(userId).lean();
    expect(user).toMatchObject({ displayName: 'Removed member' });
    expect(user!.email).toBeUndefined();
  });
});

describe('study circles (phase 2)', () => {
  it('invites, joins with a single-use token hash, scores study days once and enforces owner rules', async () => {
    const owner = await registered('Etc/UTC');
    const friend = await registered('Etc/UTC');
    const circle = await as(owner.token).post('/circles', { name: 'Data crew', timezone: 'Etc/UTC', weekly_target_days: 4 }).expect(201);
    const invite = await as(owner.token).post(`/circles/${circle.body.id}/invites`).expect(201);
    const token = new URL(invite.body.invite_url.replace('certpath://', 'https://x/')).searchParams.get('token')!;
    await as(friend.token).post('/circle-joins', { token: token + 'x' }).expect(409);
    const joined = await as(friend.token).post('/circle-joins', { token }).expect(200);
    expect(joined.body.members).toHaveLength(2);

    await completeLesson(friend.token, await enroll(friend.token));
    const view = await as(owner.token).get(`/circles/${circle.body.id}`).expect(200);
    const friendRow = view.body.members.find((m: { is_you: boolean }) => !m.is_you);
    expect(friendRow.study_days).toBe(1);
    expect(view.body.note).toBe('Each study day counts once per person.');

    const outsider = await guest();
    await as(outsider.token).get(`/circles/${circle.body.id}`).expect(404);
    expect((await as(owner.token).post(`/circles/${circle.body.id}/leave`).expect(409)).body.code).toBe('owner_must_transfer');
    await as(friend.token).post(`/circles/${circle.body.id}/leave`).expect(200);
    await as(friend.token).get(`/circles/${circle.body.id}`).expect(404);
  });
});
