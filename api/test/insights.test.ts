import { describe, expect, it } from 'vitest';
import { ScoreSnapshot } from '../src/models/index.js';
import { addDays } from '../src/lib/time.js';
import { bandFor, objectiveScore, resolvePeriod } from '../src/services/insights.js';
import { as, completeLesson, enroll, guest } from './helpers.js';

describe('CertPath Score', () => {
  it('rewards coverage and first-try accuracy, smoothing thin evidence', () => {
    expect(objectiveScore(0, 0)).toBe(0);
    // One right answer is weak evidence: 1/5 coverage and accuracy pulled toward 50%.
    expect(objectiveScore(1, 1)).toBeCloseTo(0.2 * (2 / 3), 5);
    expect(objectiveScore(5, 5)).toBeCloseTo(6 / 7, 5);
    expect(objectiveScore(10, 5)).toBeCloseTo(0.5, 5);
    expect(objectiveScore(20, 20)).toBeGreaterThan(objectiveScore(5, 5));
    expect(bandFor(0)).toBe('Getting started');
    expect(bandFor(50)).toBe('Solid');
    expect(bandFor(92)).toBe('Mastering');
  });

  it('weights domains by the blueprint, keeps a trend, and says it is not a prediction', async () => {
    const { token } = await guest('Etc/UTC');
    const enrollmentId = await enroll(token);
    const before = (await as(token).get(`/enrollments/${enrollmentId}/score`).expect(200)).body;
    expect(before).toMatchObject({ score: 0, band: 'Getting started', delta_7d: null });
    expect(before.note).toMatch(/not a prediction/);

    await completeLesson(token, enrollmentId);
    const after = (await as(token).get(`/enrollments/${enrollmentId}/score`).expect(200)).body;
    expect(after.score).toBeGreaterThan(0);
    expect(after.score).toBeLessThan(10);
    const sum = after.domains.reduce((s: number, d: { weight_percent: number }) => s + d.weight_percent, 0);
    expect(sum).toBe(100);
    expect(after.domains.find((d: { title: string }) => d.title === 'Data transformation and modeling').score).toBeGreaterThan(0);
    expect(after.history.at(-1).score).toBe(after.score);

    // A week-old snapshot gives the weekly change.
    const today = after.history.at(-1).date;
    await ScoreSnapshot.create({ userId: (await as(token).get('/me')).body.user.id, enrollmentId, date: addDays(today, -8), score: 0 });
    const trend = (await as(token).get(`/enrollments/${enrollmentId}/score`).expect(200)).body;
    expect(trend.delta_7d).toBe(after.score);
    expect(trend.history).toHaveLength(2);
  });
});

describe('recaps', () => {
  it('resolves periods, defaulting to last month in the first week', () => {
    expect(resolvePeriod('month', undefined, '2026-11-03')).toMatchObject({ start: '2026-10-01', end: '2026-11-01', label: 'October 2026' });
    expect(resolvePeriod('month', undefined, '2026-10-26')).toMatchObject({ start: '2026-10-01', end: '2026-11-01' });
    expect(resolvePeriod('year', '2026', '2026-10-26')).toMatchObject({ start: '2026-01-01', end: '2027-01-01', label: '2026' });
    expect(() => resolvePeriod('month', 'October', '2026-10-26')).toThrow();
  });

  it('summarizes the month: study days, answers, XP, persona and a share line', async () => {
    const { token } = await guest('Etc/UTC');
    const empty = (await as(token).get('/me/recap?period=month').expect(200)).body;
    expect(empty.empty).toBe(true);
    const enrollmentId = await enroll(token);
    await completeLesson(token, enrollmentId);
    const month = new Date().toISOString().slice(0, 7);
    const r = (await as(token).get(`/me/recap?period=month&value=${month}`).expect(200)).body;
    expect(r).toMatchObject({ empty: false, study_days: 1, longest_streak: 1, answered: 5, accuracy: 60, lessons: 1, xp: 75 });
    expect(r.top_domain).toBe('Data transformation and modeling');
    expect(r.badges).toContain('First steps');
    expect(r.persona.title).toBeTruthy();
    expect(r.share_text).toMatch(/1 study day, 5 questions answered, 75 XP/);
    const year = (await as(token).get(`/me/recap?period=year&value=${month.slice(0, 4)}`).expect(200)).body;
    expect(year.period.label).toBe(month.slice(0, 4));
    await as(token).get('/me/recap?period=decade').expect(400);
  });
});
