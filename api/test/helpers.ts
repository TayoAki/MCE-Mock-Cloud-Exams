import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Exam, ExamVersion, Lesson } from '../src/models/index.js';
import { config } from '../src/config.js';

export const app = createApp();
export const id = () => randomUUID();

/** The plan's walkthrough: A, B, B, A, D on the first lesson scores 3/5. */
export const SAMPLE_PICKS = ['A', 'B', 'B', 'A', 'D'];

export function as(token?: string) {
  const auth = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  return {
    get: (path: string) => auth(request(app).get(`/v1${path}`)),
    post: (path: string, body: object = {}) => auth(request(app).post(`/v1${path}`).send(body)),
    patch: (path: string, body: object = {}) => auth(request(app).patch(`/v1${path}`).send(body)),
    put: (path: string, body: object = {}) => auth(request(app).put(`/v1${path}`).send(body)),
    delete: (path: string, body: object = {}) => auth(request(app).delete(`/v1${path}`).send(body)),
  };
}

export async function guest(timezone = 'America/New_York') {
  const res = await as().post('/auth/guest', { timezone }).expect(201);
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

export async function registered(timezone = 'America/New_York') {
  const res = await as()
    .post('/auth/register', { email: `u${randomUUID()}@example.com`, password: 'a long enough password', timezone })
    .expect(201);
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

export async function admin() {
  const res = await as().post('/auth/login', { email: config.SEED_ADMIN_EMAIL, password: config.SEED_ADMIN_PASSWORD }).expect(200);
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

export async function pilotVersionId() {
  const exam = await Exam.findOne({ slug: 'databricks-de-associate' }).lean();
  return (await ExamVersion.findOne({ examId: exam!._id }).lean())!._id;
}

export async function enroll(token: string) {
  const res = await as(token).post('/enrollments', { exam_version_id: await pilotVersionId(), client_request_id: id() }).expect(201);
  return res.body.id as string;
}

export async function lessonId(title: string) {
  return (await Lesson.findOne({ title }).lean())!._id;
}

export async function startLesson(token: string, enrollmentId: string, lesson?: string) {
  const path = await as(token).get(`/enrollments/${enrollmentId}/path`).expect(200);
  const res = await as(token)
    .post('/sessions', { enrollment_id: enrollmentId, client_session_id: id(), mode: 'lesson', lesson_id: lesson ?? path.body.current_lesson_id })
    .expect(201);
  return res.body;
}

export async function answerAll(token: string, session: { id: string; items: { session_item_id: string }[] }, picks: string[] = SAMPLE_PICKS) {
  const receipts = [];
  for (const [i, item] of session.items.entries()) {
    const res = await as(token)
      .post(`/sessions/${session.id}/answers`, { session_item_id: item.session_item_id, client_submission_id: id(), selected_options: [picks[i % picks.length]] })
      .expect(200);
    receipts.push(res.body);
  }
  return receipts;
}

/** Completes the current lesson with the sample picks. */
export async function completeLesson(token: string, enrollmentId: string, lesson?: string) {
  const session = await startLesson(token, enrollmentId, lesson);
  await answerAll(token, session);
  return (await as(token).post(`/sessions/${session.id}/complete`).expect(200)).body;
}
