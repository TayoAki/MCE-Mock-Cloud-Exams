import { describe, expect, it } from 'vitest';
import { allocateBlueprint, creditStreak, displayedStreak, nextReview } from '../src/lib/rules.js';
import { inQuietHours, localDate, localTimeOn, startOfLocalDay } from '../src/lib/time.js';
import { gradeSelection } from '../src/services/grading.js';

describe('local dates', () => {
  it('uses the learner date across UTC midnight', () => {
    expect(localDate(new Date('2026-10-25T02:00:00Z'), 'America/New_York')).toBe('2026-10-24');
  });
  it('keeps the same local study date across the DST fall-back hour', () => {
    const a = localDate(new Date('2026-11-01T05:30:00Z'), 'America/New_York');
    const b = localDate(new Date('2026-11-01T06:30:00Z'), 'America/New_York');
    expect(a).toBe(b);
  });
  it('finds local midnight as a UTC instant, including on DST days', () => {
    expect(startOfLocalDay('2026-10-25', 'America/New_York').toISOString()).toBe('2026-10-25T04:00:00.000Z');
    expect(startOfLocalDay('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
  it('moves a reminder time that does not exist (spring forward) to a valid time', () => {
    const at = localTimeOn('2027-03-14', '02:30', 'America/New_York');
    expect(localDate(at, 'America/New_York')).toBe('2027-03-14');
    expect(at.toISOString()).toBe('2027-03-14T07:30:00.000Z');
  });
  it('handles quiet hours that cross midnight', () => {
    expect(inQuietHours('23:30', '23:00', '08:00')).toBe(true);
    expect(inQuietHours('07:59', '23:00', '08:00')).toBe(true);
    expect(inQuietHours('08:00', '23:00', '08:00')).toBe(false);
    expect(inQuietHours('21:00', '23:00', '08:00')).toBe(false);
  });
});

describe('streaks', () => {
  const state = { lastStudyDate: '2026-10-24', currentDays: 3, longestDays: 5 };
  it('same-day completion preserves the streak', () => {
    expect(creditStreak(state, '2026-10-24')).toMatchObject({ currentDays: 3, inserted: false });
  });
  it('an adjacent day extends it', () => {
    expect(creditStreak(state, '2026-10-25').currentDays).toBe(4);
  });
  it('a gap restarts current and keeps longest', () => {
    expect(creditStreak({ ...state, lastStudyDate: '2026-10-22' }, '2026-10-25')).toEqual({
      lastStudyDate: '2026-10-25',
      currentDays: 1,
      longestDays: 5,
      inserted: true,
    });
  });
  it('refuses to credit a date before the last one', () => {
    expect(() => creditStreak(state, '2026-10-20')).toThrow();
  });
  it('shows a broken streak as zero after a missed day', () => {
    expect(displayedStreak(state, '2026-10-25')).toBe(3);
    expect(displayedStreak(state, '2026-10-26')).toBe(0);
  });
});

describe('review schedule', () => {
  it('a wrong answer returns the concept tomorrow, across a month boundary', () => {
    expect(nextReview(3, false, '2026-10-31')).toEqual({ stage: 0, dueLocalDate: '2026-11-01' });
  });
  it('a correct review advances one stage with a growing interval', () => {
    expect(nextReview(0, true, '2026-10-30')).toEqual({ stage: 1, dueLocalDate: '2026-10-31' });
    expect(nextReview(1, true, '2026-10-30')).toEqual({ stage: 2, dueLocalDate: '2026-11-02' });
    expect(nextReview(3, true, '2026-10-30')).toEqual({ stage: 4, dueLocalDate: '2026-11-13' });
    expect(nextReview(4, true, '2026-10-30')).toEqual({ stage: 4, dueLocalDate: '2026-11-13' });
  });
});

describe('blueprint allocation', () => {
  it('allocates a 45-item form as 3/9/10/7/4/5/7', () => {
    expect(allocateBlueprint(45, [6, 21, 22, 16, 10, 10, 15])).toEqual([3, 9, 10, 7, 4, 5, 7]);
  });
  it('always allocates exactly the requested count', () => {
    for (let n = 1; n <= 60; n++) expect(allocateBlueprint(n, [6, 21, 22, 16, 10, 10, 15]).reduce((a, b) => a + b, 0)).toBe(n);
  });
  it('rejects weights that do not total 100', () => {
    expect(() => allocateBlueprint(10, [50, 40])).toThrow();
  });
});

describe('grading', () => {
  it('requires an exact set for multiple answers', () => {
    expect(gradeSelection(['A', 'B', 'C'], ['C', 'B', 'A'])).toBe(true);
    expect(gradeSelection(['A', 'B'], ['A', 'B', 'C'])).toBe(false);
    expect(gradeSelection(['A', 'B', 'C', 'D'], ['A', 'B', 'C'])).toBe(false);
  });
});
