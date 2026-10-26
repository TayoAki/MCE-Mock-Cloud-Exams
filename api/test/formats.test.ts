import { describe, expect, it } from 'vitest';
import { canonicalAnswer, gradeAnswer, keyMatchPairs, keyOrderSteps, seededRandom, typedMatches } from '../src/lib/answers.js';
import { GemLedger, Objective, QuestionFamily, QuestionKey, QuestionVersion, Story } from '../src/models/index.js';
import { latestPublishedByFamily } from '../src/services/content.js';
import { mockInventory } from '../src/services/selection.js';
import { admin, as, enroll, guest, id, pilotVersionId } from './helpers.js';

describe('answer rules', () => {
  it('accepts typed answers regardless of case, spacing, punctuation and a small typo', () => {
    expect(typedMatches('vacuum', ['VACUUM'])).toBe(true);
    expect(typedMatches('  Version   as of. ', ['VERSION AS OF'])).toBe(true);
    expect(typedMatches('z order', ['ZORDER'])).toBe(true);
    expect(typedMatches('describe histroy', ['DESCRIBE HISTORY'])).toBe(true);
    expect(typedMatches('vacum', ['VACUUM'])).toBe(true);
    // Short answers must be exact, and real mistakes still fail.
    expect(typedMatches('gild', ['gold'])).toBe(false);
    expect(typedMatches('OPTIMIZE', ['VACUUM'])).toBe(false);
    expect(typedMatches('', ['VACUUM'])).toBe(false);
  });

  it('checks each format’s shape and grades order exactly and pairs as a set', () => {
    const order = { answerType: 'order' as const, options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }] };
    expect(() => canonicalAnswer(order, { selected_options: ['A', 'B'] })).toThrow();
    expect(gradeAnswer('order', canonicalAnswer(order, { selected_options: ['C', 'A', 'B'] }), { correctOptions: ['C', 'A', 'B'] })).toBe(true);
    expect(gradeAnswer('order', canonicalAnswer(order, { selected_options: ['A', 'C', 'B'] }), { correctOptions: ['C', 'A', 'B'] })).toBe(false);

    const match = { answerType: 'match' as const, options: [{ key: 'A' }, { key: 'B' }], matchTargets: [{ key: '1' }, { key: '2' }] };
    expect(() => canonicalAnswer(match, { selected_options: ['A=1', 'B=1'] })).toThrow();
    expect(() => canonicalAnswer(match, { selected_options: ['A=1'] })).toThrow();
    expect(gradeAnswer('match', canonicalAnswer(match, { selected_options: ['B=1', 'A=2'] }), { correctOptions: ['A=2', 'B=1'] })).toBe(true);

    const typed = { answerType: 'type' as const, options: [] };
    expect(() => canonicalAnswer(typed, { selected_options: [], typed_answer: '   ' })).toThrow();
    expect(gradeAnswer('type', canonicalAnswer(typed, { selected_options: [], typed_answer: 'Bronze.' }), { correctOptions: [], acceptedAnswers: ['bronze'] })).toBe(true);
  });

  it('scrambles order and match keys so letters never give the answer away', () => {
    for (let i = 0; i < 50; i++) {
      const rng = seededRandom(`steps-${i}`);
      const order = keyOrderSteps(['one', 'two', 'three'], rng);
      expect(order.correct).not.toEqual(['A', 'B', 'C']);
      expect(order.options.map((o) => o.key)).toEqual(['A', 'B', 'C']);
      const match = keyMatchPairs([{ left: 'x', right: '1x' }, { left: 'y', right: '1y' }, { left: 'z', right: '1z' }], rng);
      expect(match.correct).not.toEqual(['A=1', 'B=2', 'C=3']);
      expect(match.targets.map((t) => t.key)).toEqual(['1', '2', '3']);
    }
  });
});

/** Correct answers for a session item, read from the private key the way a reviewer would. */
async function correctBody(item: { session_item_id: string; question_version_id: string; answer_type: string }) {
  const key = (await QuestionKey.findById(item.question_version_id).lean())!;
  return item.answer_type === 'type'
    ? { selected_options: [], typed_answer: key.acceptedAnswers[0], input_mode: 'voice' }
    : { selected_options: key.correctOptions };
}

describe('stories', () => {
  it('tells the story with its questions inline, grades every format, and pays out once', async () => {
    const { token, userId } = await guest('Etc/UTC');
    const enrollmentId = await enroll(token);
    const list = (await as(token).get(`/enrollments/${enrollmentId}/stories`).expect(200)).body.stories;
    expect(list.map((s: { title: string }) => s.title)).toEqual(['The doubled revenue', 'Files that keep coming']);
    expect(list[0]).toMatchObject({ question_count: 4, completed: false, active_session_id: null });

    const start = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'story', story_id: list[0].id }).expect(201);
    const session = start.body;
    expect(session.mode).toBe('story');
    expect(session.items.map((i: { answer_type: string }) => i.answer_type)).toEqual(['type', 'single', 'order', 'single']);
    const questionParts = session.story.parts.filter((p: { kind: string }) => p.kind === 'question');
    expect(questionParts.map((p: { session_item_id: string }) => p.session_item_id)).toEqual(session.items.map((i: { session_item_id: string }) => i.session_item_id));
    expect(session.story.parts[0]).toMatchObject({ kind: 'line', speaker: 'Marco' });

    // Starting again resumes the same session.
    const resumed = await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'story', story_id: list[0].id }).expect(201);
    expect(resumed.body.id).toBe(session.id);

    // A typed answer with a typo still counts; a wrong order does not, and feedback shows the right sequence.
    const [typedItem, singleItem, orderItem, lastItem] = session.items;
    const typo = await as(token)
      .post(`/sessions/${session.id}/answers`, { session_item_id: typedItem.session_item_id, client_submission_id: id(), selected_options: [], typed_answer: 'describe histroy', input_mode: 'voice' })
      .expect(200);
    expect(typo.body.feedback).toMatchObject({ correct: true, expected_answer: 'DESCRIBE HISTORY' });
    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: singleItem.session_item_id, client_submission_id: id(), ...(await correctBody(singleItem)) }).expect(200);
    const key = (await QuestionKey.findById(orderItem.question_version_id).lean())!.correctOptions;
    const wrong = [...key].reverse();
    const orderReceipt = await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: orderItem.session_item_id, client_submission_id: id(), selected_options: wrong }).expect(200);
    expect(orderReceipt.body.feedback).toMatchObject({ correct: false, correct_options: key });
    // A retry with the same body replays; a different body under the same ID conflicts.
    const submissionId = id();
    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: lastItem.session_item_id, client_submission_id: submissionId, ...(await correctBody(lastItem)) }).expect(200);
    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: lastItem.session_item_id, client_submission_id: submissionId, ...(await correctBody(lastItem)) }).expect(200);
    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: lastItem.session_item_id, client_submission_id: submissionId, selected_options: ['Z'] }).expect(409);

    const view = (await as(token).get(`/sessions/${session.id}`).expect(200)).body;
    expect(view.items[0].submission).toMatchObject({ typed_answer: 'describe histroy' });
    const done = (await as(token).post(`/sessions/${session.id}/complete`).expect(200)).body;
    expect(done).toMatchObject({ correct: 3, total: 4 });
    expect(await GemLedger.exists({ userId, reason: 'story_complete' })).toBeTruthy();
    expect(done.engagement.celebrations.map((c: { payload: { key?: string } }) => c.payload.key)).toContain('story_1');
    const after = (await as(token).get(`/enrollments/${enrollmentId}/stories`).expect(200)).body.stories;
    expect(after[0].completed).toBe(true);
  });

  it('keeps story questions out of regular practice, and mocks and timed quizzes to exam formats', async () => {
    const versionId = await pilotVersionId();
    const storyFamilies = (await Story.find({ examVersionId: versionId }).lean()).flatMap((s) => s.parts.flatMap((p) => (p.familyId ? [p.familyId] : [])));
    expect(storyFamilies).toHaveLength(8);
    expect((await latestPublishedByFamily(versionId, storyFamilies)).size).toBe(0);
    expect((await latestPublishedByFamily(versionId, storyFamilies, { stories: true })).size).toBe(8);
    // 60 multiple-choice items plus the one listening item in single-answer form.
    expect((await mockInventory(versionId)).published_questions).toBe(61);
  });
});

describe('authoring the new formats', () => {
  it('stores order and match questions with scrambled keys, and typed answers with accepted answers', async () => {
    const { token } = await admin();
    const versionId = await pilotVersionId();
    const objective = await Objective.findOne({ examVersionId: versionId }).lean();
    const common = { exam_version_id: versionId, objective_id: objective!._id, rationale: 'Because the docs say so.', source_url: 'https://docs.databricks.com/aws/en/delta/' };

    const order = await as(token)
      .post('/admin/questions', {
        ...common,
        family_key: 'authoring-order',
        prompt: 'Put these steps in the right order.',
        answer_type: 'order',
        options: [{ key: 'A', text: 'First' }, { key: 'B', text: 'Second' }, { key: 'C', text: 'Third' }, { key: 'D', text: 'Fourth' }],
        correct_options: ['A', 'B', 'C', 'D'],
      })
      .expect(201);
    const byKey = new Map(order.body.options.map((o: { key: string; text: string }) => [o.key, o.text]));
    expect(order.body.correct_options.map((k: string) => byKey.get(k))).toEqual(['First', 'Second', 'Third', 'Fourth']);
    expect(order.body.correct_options).not.toEqual(['A', 'B', 'C', 'D']);

    const match = await as(token)
      .post('/admin/questions', {
        ...common,
        family_key: 'authoring-match',
        prompt: 'Match each command to what it does.',
        answer_type: 'match',
        presentation: 'listen',
        options: [{ key: 'A', text: 'VACUUM' }, { key: 'B', text: 'OPTIMIZE' }, { key: 'C', text: 'RESTORE' }],
        match_targets: [{ key: '1', text: 'cleans files' }, { key: '2', text: 'compacts files' }, { key: '3', text: 'rolls back' }],
        correct_options: ['A=1', 'B=2', 'C=3'],
      })
      .expect(201);
    const targets = new Map(match.body.match_targets.map((t: { key: string; text: string }) => [t.key, t.text]));
    const pairs = match.body.correct_options.map((p: string) => [byKeyOf(match.body.options, p.split('=')[0]!), targets.get(p.split('=')[1]!)]);
    expect(pairs).toEqual([['VACUUM', 'cleans files'], ['OPTIMIZE', 'compacts files'], ['RESTORE', 'rolls back']]);
    expect(match.body.presentation).toBe('listen');

    const missing = await as(token).post('/admin/questions', { ...common, family_key: 'authoring-type-bad', prompt: 'Which command cleans up old files?', answer_type: 'type', options: [], correct_options: [] }).expect(400);
    expect(missing.body.code).toBe('question_invalid');
    const typed = await as(token)
      .post('/admin/questions', {
        ...common,
        family_key: 'authoring-type',
        prompt: 'Which command cleans up old files?',
        answer_type: 'type',
        options: [],
        correct_options: [],
        accepted_answers: [' VACUUM ', 'vacuum'],
        input_hint: 'Type the command',
      })
      .expect(201);
    expect(typed.body).toMatchObject({ answer_type: 'type', accepted_answers: ['VACUUM', 'vacuum'], input_hint: 'Type the command' });
  });

  it('builds a story from bank questions and tags them so practice skips them', async () => {
    const { token } = await admin();
    const versionId = await pilotVersionId();
    const body = {
      exam_version_id: versionId,
      slug: 'authoring-story',
      title: 'A short test story',
      characters: [{ name: 'Ana', role: 'Engineer' }],
      parts: [
        { kind: 'line', speaker: 'Ana', text: 'Something is off with the table.' },
        { kind: 'question', family_key: 'authoring-type' },
      ],
      status: 'published',
    };
    // The question is still a draft, so the story can't be published yet.
    expect((await as(token).post('/admin/stories', body).expect(409)).body.code).toBe('questions_unpublished');
    expect((await as(token).post('/admin/stories', { ...body, parts: [...body.parts, { kind: 'line', speaker: 'Bo', text: 'Hi' }], status: 'draft' }).expect(400)).body.code).toBe('unknown_speaker');
    const draft = await as(token).post('/admin/stories', { ...body, status: 'draft' }).expect(201);
    expect(draft.body.parts[1]).toEqual({ kind: 'question', family_key: 'authoring-type' });
    const family = await QuestionFamily.findOne({ familyKey: 'authoring-type' }).lean();
    expect((await QuestionVersion.findOne({ familyId: family!._id }).lean())!.storyId).toBe(draft.body.id);
    const listed = await as(token).get(`/admin/stories?exam_version_id=${versionId}`).expect(200);
    expect(listed.body.stories.map((s: { slug: string }) => s.slug)).toContain('authoring-story');
  });
});

function byKeyOf(options: { key: string; text: string }[], key: string) {
  return options.find((o) => o.key === key)?.text;
}
