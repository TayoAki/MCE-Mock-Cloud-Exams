import { Schema, model } from 'mongoose';
import { opts, uuidId } from './common.js';

const familySchema = new Schema(
  {
    _id: uuidId,
    examVersionId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    familyKey: { type: String, required: true },
    difficulty: { type: Number, min: 1, max: 3, default: 1 },
    createdBy: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
familySchema.index({ examVersionId: 1, familyKey: 1 }, { unique: true });
familySchema.index({ examVersionId: 1, objectiveId: 1 });
export const QuestionFamily = model('QuestionFamily', familySchema);

const optionSchema = new Schema(
  { key: { type: String, required: true, match: /^[A-Z]$/ }, text: { type: String, required: true } },
  { _id: false },
);

/** The right-hand column of a match question; options are the left-hand column. */
const matchTargetSchema = new Schema(
  { key: { type: String, required: true, match: /^[1-9]$/ }, text: { type: String, required: true } },
  { _id: false },
);

/**
 * How a question is answered:
 * - single / multiple: choose options.
 * - order: tap the options into sequence. Keys are scrambled at authoring time so their letters never reveal the order.
 * - match: pair each option with one match target.
 * - type: type (or say) a short answer, graded against accepted answers.
 */
export const ANSWER_TYPES = ['single', 'multiple', 'order', 'match', 'type'] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];
/** Formats that mirror the real exam. Mocks use only these. */
export const EXAM_ANSWER_TYPES: AnswerType[] = ['single', 'multiple'];

/** Immutable once published: edits create a new revision. */
const questionVersionSchema = new Schema(
  {
    _id: uuidId,
    familyId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    domainId: { type: String, required: true },
    revision: { type: Number, required: true, min: 1 },
    prompt: { type: String, required: true, minlength: 10, maxlength: 4000 },
    answerType: { type: String, required: true, enum: ANSWER_TYPES, default: 'single' },
    options: { type: [optionSchema], default: [] },
    matchTargets: { type: [matchTargetSchema], default: [] },
    /** 'listen' reads the prompt aloud first and hides the text until asked. */
    presentation: { type: String, enum: ['text', 'listen'], default: 'text' },
    /** Placeholder for typed answers, e.g. "Type the command". */
    inputHint: { type: String, maxlength: 80, default: null },
    /** Set for questions written inside a story; they are served only by that story. */
    storyId: { type: String, default: null },
    sourceUrl: { type: String, required: true },
    status: { type: String, required: true, enum: ['draft', 'published', 'retired'], default: 'draft' },
    createdBy: { type: String },
    createdAt: { type: Date, required: true, default: Date.now },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    publishedAt: { type: Date },
    retiredAt: { type: Date },
  },
  opts,
);
questionVersionSchema.index({ familyId: 1, revision: 1 }, { unique: true });
questionVersionSchema.index({ examVersionId: 1, status: 1, familyId: 1 });
questionVersionSchema.pre('validate', function () {
  if (this.status === 'published' && (!this.reviewedBy || !this.reviewedAt)) {
    throw new Error('A published question must record its reviewer');
  }
  const type = this.answerType as AnswerType;
  if (type === 'type' && this.options.length) throw new Error('A typed-answer question has no options');
  if (type !== 'type' && this.options.length < 2) throw new Error('This question needs at least two options');
  if (type === 'match' && this.matchTargets.length < this.options.length) throw new Error('Every option needs a match target');
});
export const QuestionVersion = model('QuestionVersion', questionVersionSchema);

/**
 * Private grading data (private.correct_options + private.question_explanations).
 * Never select this in delivery queries; feedback joins it only after grading.
 */
const questionKeySchema = new Schema(
  {
    _id: { type: String, required: true }, // question version id
    /** Choices for single/multiple, the sequence for order, "A=2" pairs for match; empty for typed answers. */
    correctOptions: { type: [String], default: [] },
    /** Typed answers that count as correct; the first is shown as the answer. */
    acceptedAnswers: { type: [String], default: [] },
    rationale: { type: String, required: true },
    reviewedNotes: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now },
  },
  { ...opts, collection: 'private_question_keys' },
);
export const QuestionKey = model('QuestionKey', questionKeySchema);

const storyLineSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ['line', 'question'] },
    /** For lines: who speaks (a character name), or null for narration. */
    speaker: { type: String, default: null },
    text: { type: String, default: null, maxlength: 600 },
    /** For questions: the family asked at this point of the story. */
    familyId: { type: String, default: null },
  },
  { _id: false },
);

/**
 * A short workplace scenario told line by line, with questions at the moments
 * a decision is needed. Story questions live in the bank with storyId set.
 */
const storySchema = new Schema(
  {
    _id: uuidId,
    examVersionId: { type: String, required: true },
    slug: { type: String, required: true },
    title: { type: String, required: true, maxlength: 80 },
    summary: { type: String, default: '', maxlength: 200 },
    characters: { type: [{ name: String, role: String, _id: false }], default: [] },
    parts: { type: [storyLineSchema], default: [] },
    sortOrder: { type: Number, required: true, min: 1 },
    status: { type: String, required: true, enum: ['draft', 'published', 'retired'], default: 'draft' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  opts,
);
storySchema.index({ examVersionId: 1, slug: 1 }, { unique: true });
export const Story = model('Story', storySchema);
