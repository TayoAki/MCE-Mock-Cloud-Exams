import { Schema, model } from 'mongoose';
import { DATE_RE, opts, uuidId } from './common.js';

export const PUBLICATION_STATUS = ['draft', 'published', 'retired'] as const;

const examSchema = new Schema(
  {
    _id: uuidId,
    slug: { type: String, required: true, unique: true },
    provider: { type: String, required: true, enum: ['aws', 'databricks', 'microsoft'] },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    status: { type: String, required: true, enum: ['planned', 'pilot', 'active', 'retired'], default: 'planned' },
    canonicalUrl: { type: String, required: true },
    sortOrder: { type: Number, default: 1 },
  },
  opts,
);
export const Exam = model('Exam', examSchema);

const examVersionSchema = new Schema(
  {
    _id: uuidId,
    examId: { type: String, required: true, ref: 'Exam' },
    versionLabel: { type: String, required: true },
    effectiveFrom: { type: String, required: true, match: DATE_RE },
    effectiveUntil: { type: String, match: DATE_RE, default: null },
    questionCount: { type: Number, required: true, min: 1 },
    durationMinutes: { type: Number, required: true, min: 1 },
    passingNote: { type: String, default: '' },
    guideUrl: { type: String, required: true },
    status: { type: String, required: true, enum: PUBLICATION_STATUS, default: 'draft' },
    publishedAt: { type: Date },
    publishedBy: { type: String },
  },
  opts,
);
examVersionSchema.index({ examId: 1, versionLabel: 1 }, { unique: true });
export const ExamVersion = model('ExamVersion', examVersionSchema);

const domainSchema = new Schema(
  {
    _id: uuidId,
    examVersionId: { type: String, required: true },
    code: { type: String, required: true },
    title: { type: String, required: true },
    weightPercent: { type: Number, required: true, min: 0, max: 100 },
    sortOrder: { type: Number, required: true, min: 1 },
  },
  opts,
);
domainSchema.index({ examVersionId: 1, code: 1 }, { unique: true });
export const Domain = model('Domain', domainSchema);

const objectiveSchema = new Schema(
  {
    _id: uuidId,
    examVersionId: { type: String, required: true },
    domainId: { type: String, required: true },
    code: { type: String, required: true },
    title: { type: String, required: true },
    sortOrder: { type: Number, default: 1 },
  },
  opts,
);
objectiveSchema.index({ examVersionId: 1, code: 1 }, { unique: true });
export const Objective = model('Objective', objectiveSchema);

const unitSchema = new Schema(
  {
    _id: uuidId,
    examVersionId: { type: String, required: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    sortOrder: { type: Number, required: true, min: 1 },
  },
  opts,
);
unitSchema.index({ examVersionId: 1, sortOrder: 1 });
export const Unit = model('Unit', unitSchema);

const lessonSchema = new Schema(
  {
    _id: uuidId,
    examVersionId: { type: String, required: true },
    unitId: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    kind: { type: String, required: true, enum: ['learn', 'review', 'checkpoint'], default: 'learn' },
    questionCount: { type: Number, required: true, min: 1, max: 50, default: 5 },
    sortOrder: { type: Number, required: true, min: 1 },
    status: { type: String, required: true, enum: PUBLICATION_STATUS, default: 'draft' },
    objectiveIds: { type: [String], default: [] },
    /** Ordered families this lesson may assign (replaces lesson_question_pool). */
    poolFamilyIds: { type: [String], default: [] },
  },
  opts,
);
lessonSchema.index({ examVersionId: 1, unitId: 1, sortOrder: 1 });
export const Lesson = model('Lesson', lessonSchema);
