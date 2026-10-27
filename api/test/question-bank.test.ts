import { describe, expect, it } from 'vitest';
import { blueprint, checkBank } from '../question-factory/checks.js';
import { loadBankFiles } from '../question-factory/validate.js';
import { Objective, QuestionFamily, QuestionKey, QuestionVersion } from '../src/models/index.js';
import { FIXTURE_REVIEWER_ID } from '../src/seed/seed.js';
import { addQuestionBank, bankItems } from '../src/seed/questions/index.js';
import { arrangeItem, composeRationale } from '../src/seed/questions/schema.js';
import { mockInventory } from '../src/services/selection.js';
import { pilotVersionId } from './helpers.js';

describe('question factory bank', () => {
  it('passes every check in the authoring spec', async () => {
    const report = checkBank(await loadBankFiles());
    expect(report.findings.filter((f) => f.level === 'error')).toEqual([]);
  });

  it('meets the blueprint: every objective at its target, with the difficulty and format mix', async () => {
    const report = checkBank(await loadBankFiles());
    for (const o of blueprint.objectives) expect([o.code, report.byObjective[o.code]!.have]).toEqual([o.code, o.target]);
    const items = report.items;
    expect(items).toHaveLength(422);
    const share = (d: number) => items.filter((i) => i.difficulty === d).length / items.length;
    expect(share(1)).toBeGreaterThan(0.3);
    expect(share(3)).toBeGreaterThan(0.15);
    expect(items.filter((i) => i.type === 'multiple').length / items.length).toBeLessThanOrEqual(0.12);
    // Shuffling spreads single-answer keys across the letters.
    const keys = items.filter((i) => i.type === 'single').map((i) => arrangeItem(i).correct[0]);
    for (const letter of ['A', 'B', 'C', 'D']) expect(keys.filter((k) => k === letter).length / keys.length).toBeGreaterThan(0.15);
  });

  it('seeds once, with the guide objectives, difficulty, shuffled keys and composed explanations', async () => {
    const examVersionId = await pilotVersionId();
    for (const o of blueprint.objectives) expect(await Objective.exists({ examVersionId, code: o.code })).toBeTruthy();

    const item = bankItems()[0]!;
    const family = (await QuestionFamily.findOne({ examVersionId, familyKey: item.family }).lean())!;
    expect(family.difficulty).toBe(item.difficulty);
    const qv = (await QuestionVersion.findOne({ familyId: family._id }).lean())!;
    const key = (await QuestionKey.findById(qv._id).lean())!;
    expect(qv).toMatchObject({ status: 'published', prompt: item.stem, answerType: item.type, sourceUrl: item.source });
    const correctTexts = item.options.filter((o) => o.correct).map((o) => o.text).sort();
    expect(key.correctOptions.map((k) => qv.options.find((o) => o.key === k)!.text).sort()).toEqual(correctTexts);
    expect(key.rationale).toBe(composeRationale(item));
    expect(key.rationale.startsWith(item.options.find((o) => o.correct)!.why)).toBe(true);
    expect(key.reviewedNotes).toContain(item.evidence);

    // An explanation stored in an older layout (same words) is brought up to date; an edited one is left alone.
    await QuestionKey.updateOne({ _id: qv._id }, { $set: { rationale: key.rationale.replace(/\n\n/g, ' ') } });
    const second = bankItems()[1]!;
    const secondQv = (await QuestionVersion.findOne({ familyId: (await QuestionFamily.findOne({ examVersionId, familyKey: second.family }).lean())!._id }).lean())!;
    await QuestionKey.updateOne({ _id: secondQv._id }, { $set: { rationale: 'Edited by a reviewer.' } });
    const before = await QuestionFamily.countDocuments({ examVersionId });
    expect((await addQuestionBank(examVersionId, { publish: true, reviewerId: FIXTURE_REVIEWER_ID })).added).toBe(0);
    expect(await QuestionFamily.countDocuments({ examVersionId })).toBe(before);
    expect((await QuestionKey.findById(qv._id).lean())!.rationale).toBe(composeRationale(item));
    expect((await QuestionKey.findById(secondQv._id).lean())!.rationale).toBe('Edited by a reviewer.');
  });

  it('fills a full 45-question mock exam across every domain', async () => {
    const inventory = await mockInventory(await pilotVersionId());
    expect(inventory.full_form_available).toBe(true);
    expect(inventory.published_questions).toBeGreaterThanOrEqual(270);
  });
});
