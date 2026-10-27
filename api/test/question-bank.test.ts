import { describe, expect, it } from 'vitest';
import { blueprint, checkBank } from '../question-factory/checks.js';
import { loadBankFiles } from '../question-factory/validate.js';
import { Objective, QuestionFamily, QuestionKey, QuestionVersion } from '../src/models/index.js';
import { FIXTURE_REVIEWER_ID } from '../src/seed/seed.js';
import { addQuestionBank, bankItems } from '../src/seed/questions/index.js';
import { arrangeItem, composeRationale, type Item } from '../src/seed/questions/schema.js';
import { WITHDRAWN_FAMILIES } from '../src/seed/questions/withdrawn.js';
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

    // An explanation stored in an older layout (same words) is brought up to date in place.
    await QuestionKey.updateOne({ _id: qv._id }, { $set: { rationale: key.rationale.replace(/\n\n/g, ' ') } });
    const before = await QuestionFamily.countDocuments({ examVersionId });
    expect(await addQuestionBank(examVersionId, { publish: true, reviewerId: FIXTURE_REVIEWER_ID })).toEqual({ added: 0, revised: 0, withdrawn: 0 });
    expect(await QuestionFamily.countDocuments({ examVersionId })).toBe(before);
    expect((await QuestionKey.findById(qv._id).lean())!.rationale).toBe(composeRationale(item));
  });

  it('publishes a changed item as a new revision, unless staff have revised it', async () => {
    const examVersionId = await pilotVersionId();
    const opts = { publish: true, reviewerId: FIXTURE_REVIEWER_ID };
    const [item, staffItem] = [bankItems()[2]!, bankItems()[3]!];
    const familyOf = async (key: string) => (await QuestionFamily.findOne({ examVersionId, familyKey: key }).lean())!._id;

    const changed = { ...item, stem: `Updated: ${item.stem}`, difficulty: item.difficulty === 3 ? 1 : 3 } as Item;
    expect(await addQuestionBank(examVersionId, { ...opts, items: [changed] })).toMatchObject({ added: 0, revised: 1 });
    const versions = await QuestionVersion.find({ familyId: await familyOf(item.family) }).sort({ revision: 1 }).lean();
    expect(versions.map((v) => [v.revision, v.status])).toEqual([[1, 'retired'], [2, 'published']]);
    expect(versions[1]).toMatchObject({ prompt: changed.stem, createdBy: FIXTURE_REVIEWER_ID });
    expect((await QuestionKey.findById(versions[1]!._id).lean())!.rationale).toBe(composeRationale(changed));
    expect((await QuestionFamily.findById(await familyOf(item.family)).lean())!.difficulty).toBe(changed.difficulty);
    // Importing the same content again changes nothing.
    expect(await addQuestionBank(examVersionId, { ...opts, items: [changed] })).toMatchObject({ revised: 0 });

    // A revision made in the backoffice hands the family to staff.
    const staffFamily = await familyOf(staffItem.family);
    const published = (await QuestionVersion.findOne({ familyId: staffFamily, status: 'published' }).lean())!;
    const { _id, status, publishedAt, reviewedBy, reviewedAt, ...copy } = published;
    await QuestionVersion.create({ ...copy, revision: published.revision + 1, createdBy: 'staff-editor' });
    expect(await addQuestionBank(examVersionId, { ...opts, items: [{ ...staffItem, stem: `Updated: ${staffItem.stem}` }] })).toMatchObject({ revised: 0 });
    expect(await QuestionVersion.countDocuments({ familyId: staffFamily })).toBe(published.revision + 1);
  });

  it('retires withdrawn items and keeps their family keys out of the bank', async () => {
    const examVersionId = await pilotVersionId();
    const opts = { publish: true, reviewerId: FIXTURE_REVIEWER_ID };
    const [familyKey] = Object.keys(WITHDRAWN_FAMILIES);
    const item = { ...bankItems()[4]!, family: familyKey! };
    expect(await addQuestionBank(examVersionId, { ...opts, items: [item] })).toMatchObject({ added: 1 });
    expect(await addQuestionBank(examVersionId, { ...opts, items: [] })).toMatchObject({ withdrawn: 1 });
    const family = (await QuestionFamily.findOne({ examVersionId, familyKey }).lean())!;
    expect((await QuestionVersion.find({ familyId: family._id }).lean()).map((v) => v.status)).toEqual(['retired']);
    expect(await addQuestionBank(examVersionId, { ...opts, items: [] })).toMatchObject({ withdrawn: 0 });
    expect(checkBank({ test: [item] }).findings).toContainEqual(expect.objectContaining({ family: familyKey, level: 'error', message: expect.stringContaining('withdrawn') }));
  });

  it('fills a full 45-question mock exam across every domain', async () => {
    const inventory = await mockInventory(await pilotVersionId());
    expect(inventory.full_form_available).toBe(true);
    expect(inventory.published_questions).toBeGreaterThanOrEqual(270);
  });
});
