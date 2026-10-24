import { describe, expect, it } from 'vitest';
import { QuestionFamily, QuestionKey, QuestionVersion } from '../src/models/index.js';

describe('seed content', () => {
  it('spreads correct answers across positions and keeps the plan sample intact', async () => {
    const keys = await QuestionKey.find().lean();
    const counts: Record<string, number> = {};
    for (const k of keys) for (const c of k.correctOptions) counts[c] = (counts[c] ?? 0) + 1;
    // No single letter should hold most of the answers.
    for (const letter of ['A', 'B', 'C', 'D']) {
      expect(counts[letter] ?? 0).toBeGreaterThan(5);
      expect(counts[letter] ?? 0).toBeLessThan(keys.length / 2);
    }
    const sample = await QuestionFamily.find({ familyKey: { $in: ['retained-files', 'history-versus-data', 'vacuum-purpose', 'version-query', 'retention-settings'] } }).lean();
    const sampleKeys = await QuestionKey.find({ _id: { $in: (await QuestionVersion.find({ familyId: { $in: sample.map((f) => f._id) } }).lean()).map((q) => q._id) } }).lean();
    expect(sampleKeys.map((k) => k.correctOptions[0]).sort()).toEqual(['A', 'A', 'A', 'B', 'C']);
  });
});
