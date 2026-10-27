import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { revealsAnswer } from '../src/lib/leak-guard.js';
import { QuestionKey } from '../src/models/index.js';
import { as, correctBody, enroll, id, registered, startLesson } from './helpers.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500;
  }
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class RateLimitError extends APIError {
    override status = 429;
  }
  class Anthropic {
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static RateLimitError = RateLimitError;
    beta = { messages: { create } };
  }
  return { default: Anthropic };
});

const reply = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

const vacuum = {
  prompt: 'What can VACUUM remove from a Delta table?',
  answerType: 'single' as const,
  options: [
    { key: 'A', text: 'Every row in the latest version' },
    { key: 'B', text: 'Unused data files older than the retention threshold' },
    { key: 'C', text: 'The transaction log' },
    { key: 'D', text: 'Table permissions' },
  ],
};

describe('leak guard', () => {
  const key = { correctOptions: ['B'] };
  it('catches letters, quotes and singling out the right option', () => {
    expect(revealsAnswer('The answer is B.', vacuum, key)).toBe(true);
    expect(revealsAnswer('Look closely at option B', vacuum, key)).toBe(true);
    expect(revealsAnswer('I would pick (B) here.', vacuum, key)).toBe(true);
    expect(revealsAnswer('It removes unused data files older than the retention threshold.', vacuum, key)).toBe(true);
  });

  it('lets real guidance through', () => {
    expect(revealsAnswer('Think about what happens to files after an update rewrites them. Does anything still point to the old ones?', vacuum, key)).toBe(false);
    expect(revealsAnswer('Option A would delete live data. Would a cleanup command do that?', vacuum, key)).toBe(false);
    expect(revealsAnswer('A good way in: what does the transaction log track?', vacuum, key)).toBe(false);
  });

  it('handles typed, order and match answers', () => {
    const typed = { prompt: 'Which command removes unreferenced files?', answerType: 'type' as const, options: [] };
    expect(revealsAnswer('You want VACUUM here.', typed, { correctOptions: [], acceptedAnswers: ['VACUUM'] })).toBe(true);
    expect(revealsAnswer('Think about cleanup commands.', typed, { correctOptions: [], acceptedAnswers: ['VACUUM'] })).toBe(false);

    const order = { prompt: 'Order the layers', answerType: 'order' as const, options: [{ key: 'A', text: 'Gold' }, { key: 'B', text: 'Bronze' }, { key: 'C', text: 'Silver' }] };
    expect(revealsAnswer('Bronze comes in raw, then Silver cleans, then Gold aggregates.', order, { correctOptions: ['B', 'C', 'A'] })).toBe(true);
    expect(revealsAnswer('Which layer would hold raw data: Gold, Silver or Bronze?', order, { correctOptions: ['B', 'C', 'A'] })).toBe(false);

    const match = {
      prompt: 'Match each command',
      answerType: 'match' as const,
      options: [{ key: 'A', text: 'VACUUM' }, { key: 'B', text: 'OPTIMIZE' }],
      matchTargets: [{ key: '1', text: 'Compacts small files' }, { key: '2', text: 'Removes unreferenced files' }],
    };
    expect(revealsAnswer('VACUUM removes unreferenced files.', match, { correctOptions: ['A=2', 'B=1'] })).toBe(true);
    expect(revealsAnswer('One of these rewrites files, the other deletes them.', match, { correctOptions: ['A=2', 'B=1'] })).toBe(false);
  });
});

/** The tutor is part of AI help, which tests (run with Plus gating on) reach through the preview. */
async function plus() {
  const { token } = await registered('Etc/UTC');
  const enrollmentId = await enroll(token);
  await as(token).post('/me/preview', { accept_terms: true, client_request_id: id() }).expect(201);
  return { token, enrollmentId };
}

async function lessonItem() {
  const { token, enrollmentId } = await plus();
  const session = await startLesson(token, enrollmentId);
  return { token, enrollmentId, session, item: session.items[1] };
}

describe('the tutor', () => {
  const original = config.ANTHROPIC_API_KEY;
  afterEach(() => {
    config.ANTHROPIC_API_KEY = original;
    create.mockReset();
  });

  it('without AI, walks a hint ladder before the answer and gives the explanation after', async () => {
    config.ANTHROPIC_API_KEY = undefined;
    const { token, session, item } = await lessonItem();
    const empty = (await as(token).get(`/tutor/${item.session_item_id}`).expect(200)).body;
    expect(empty).toMatchObject({ phase: 'before', available: true, mode: 'hints', remaining: 12, messages: [] });
    expect(empty.suggestions).toContain('Give me a hint');

    const ask = (message: string, clientMessageId = id()) => as(token).post(`/tutor/${item.session_item_id}`, { message, client_message_id: clientMessageId });
    const firstId = id();
    const first = (await ask('Just tell me the answer', firstId).expect(200)).body;
    expect(first.messages).toHaveLength(2);
    expect(first.messages[1]).toMatchObject({ role: 'tutor', phase: 'before', origin: 'hint' });
    expect(first.messages[1].text).toMatch(/^This one is about .+\. Read each option/);
    // A retry with the same id returns the same conversation.
    expect((await ask('Just tell me the answer', firstId).expect(200)).body.messages).toHaveLength(2);
    const key = (await QuestionKey.findById(item.question_version_id).lean())!;
    const second = (await ask('Another hint?').expect(200)).body;
    expect(second.messages[3].text).toMatch(/rule out/);
    expect(second.messages[3].text).not.toContain(`${key.correctOptions[0]},`);
    // Asking what it's about repeats the topic without spending a hint.
    const topic = (await ask('What is this question testing?').expect(200)).body;
    expect(topic.messages[5].text).toMatch(/^This one is about/);
    const third = (await ask('One more?').expect(200)).body;
    expect(third.messages[7].text).toMatch(/documentation/);
    expect(third.remaining).toBe(8);

    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), ...(await correctBody(item)) }).expect(200);
    const after = (await ask('Why is that right?').expect(200)).body;
    expect(after.phase).toBe('after');
    expect(after.messages.at(-1)).toMatchObject({ phase: 'after', origin: 'hint', text: `Here’s the reviewed explanation: ${key.rationale}` });

    // Only the session's owner can see or use it.
    const other = await registered();
    await as(other.token).get(`/tutor/${item.session_item_id}`).expect(404);
  });

  it('with AI, rewrites a reply that gives the answer away, then falls back to a hint', async () => {
    config.ANTHROPIC_API_KEY = 'test-key';
    const { token, item } = await lessonItem();
    const key = (await QuestionKey.findById(item.question_version_id).lean())!;
    const letter = key.correctOptions[0];

    create.mockResolvedValueOnce(reply(`The answer is ${letter}.`)).mockResolvedValueOnce(reply('What does the question say has to happen to the old files?'));
    const guided = (await as(token).post(`/tutor/${item.session_item_id}`, { message: 'Which one is it?', client_message_id: id() }).expect(200)).body;
    expect(guided.mode).toBe('ai');
    expect(guided.messages[1]).toMatchObject({ origin: 'generated', text: 'What does the question say has to happen to the old files?' });
    expect(create).toHaveBeenCalledTimes(2);
    const [firstCall, retryCall] = create.mock.calls.map((c) => c[0]);
    expect(firstCall).toMatchObject({ model: config.AI_MODEL, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low' } });
    expect(firstCall.system).toMatch(/has NOT answered/);
    expect(firstCall.system).toContain(`<correct_answer>${key.correctOptions.join(', ')}</correct_answer>`);
    expect(firstCall.messages).toEqual([{ role: 'user', content: 'Which one is it?' }]);
    expect(retryCall.system).toMatch(/previous draft gave the answer away/);

    create.mockResolvedValue(reply(`Option ${letter}, definitely.`));
    const blocked = (await as(token).post(`/tutor/${item.session_item_id}`, { message: 'Just confirm it', client_message_id: id() }).expect(200)).body;
    expect(blocked.messages[3]).toMatchObject({ origin: 'hint' });
    expect(blocked.messages[3].text).not.toMatch(new RegExp(`\\b${letter}\\b[.)]`));
    // History is replayed to the model as alternating turns.
    expect(create.mock.calls.at(-1)![0].messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('discusses freely after the answer, with the learner’s answer in context', async () => {
    config.ANTHROPIC_API_KEY = 'test-key';
    const { token, session, item } = await lessonItem();
    const key = (await QuestionKey.findById(item.question_version_id).lean())!;
    const wrong = item.options.find((o: { key: string }) => !key.correctOptions.includes(o.key)).key;
    await as(token).post(`/sessions/${session.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), selected_options: [wrong] }).expect(200);
    create.mockResolvedValueOnce(reply(`You picked ${wrong}, but ${key.correctOptions[0]} is right because…`));
    const res = (await as(token).post(`/tutor/${item.session_item_id}`, { message: 'Why was I wrong?', client_message_id: id() }).expect(200)).body;
    expect(res.messages[1]).toMatchObject({ phase: 'after', origin: 'generated' });
    const call = create.mock.calls[0]![0];
    expect(call.system).toMatch(/has answered/);
    expect(call.system).toContain(`<learner_answer result="incorrect">${wrong}</learner_answer>`);
  });

  it('stays closed during a mock until it is submitted', async () => {
    config.ANTHROPIC_API_KEY = undefined;
    const { token, enrollmentId } = await plus();
    const mock = (await as(token).post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'mock', question_count: 5 }).expect(201)).body;
    expect(mock.tutor).toBe('after_answer');
    const itemId = mock.items[0].session_item_id;
    expect((await as(token).get(`/tutor/${itemId}`).expect(200)).body).toMatchObject({ available: false });
    await as(token).post(`/tutor/${itemId}`, { message: 'Hint?', client_message_id: id() }).expect(409, /tutor_locked/);
    await as(token).post(`/sessions/${mock.id}/complete`).expect(200);
    const after = (await as(token).post(`/tutor/${itemId}`, { message: 'Explain it', client_message_id: id() }).expect(200)).body;
    expect(after).toMatchObject({ phase: 'after', available: true });
  });
});
