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
    answerType: { type: String, required: true, enum: ['single', 'multiple'], default: 'single' },
    options: { type: [optionSchema], required: true },
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
});
export const QuestionVersion = model('QuestionVersion', questionVersionSchema);

/**
 * Private grading data (private.correct_options + private.question_explanations).
 * Never select this in delivery queries; feedback joins it only after grading.
 */
const questionKeySchema = new Schema(
  {
    _id: { type: String, required: true }, // question version id
    correctOptions: { type: [String], required: true },
    rationale: { type: String, required: true },
    reviewedNotes: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now },
  },
  { ...opts, collection: 'private_question_keys' },
);
export const QuestionKey = model('QuestionKey', questionKeySchema);
