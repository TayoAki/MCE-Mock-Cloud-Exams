import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { QuestionFamily, QuestionKey, QuestionVersion, User } from '../src/models/index.js';
import { seedDatabase } from '../src/seed/seed.js';
import { bankItems } from '../src/seed/questions/index.js';

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

  // Runs last in this file: it starts from an empty database, as a fresh deployment does.
  it('a production start loads the content once, with the admin and no demo learner', async () => {
    await mongoose.connection.dropDatabase();
    const first = await seedDatabase({ publish: true, accounts: true, demoLearner: false });
    const again = await seedDatabase({ publish: true, accounts: true, demoLearner: false });
    expect(again.examVersionId).toBe(first.examVersionId);
    expect(first.demoUserId).toBeUndefined();
    expect(await User.exists({ email: config.SEED_ADMIN_EMAIL })).toBeTruthy();
    expect(await User.exists({ email: config.SEED_DEMO_EMAIL })).toBeNull();
    // 78 hand-written seed questions plus the question factory's bank.
    expect(await QuestionFamily.countDocuments()).toBe(78 + bankItems().length);
  });
});
