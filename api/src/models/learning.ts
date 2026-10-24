import { Schema, model } from 'mongoose';
import { DATE_RE, opts, uuidId } from './common.js';

export const SESSION_MODES = [
  'lesson',
  'quick',
  'weakest',
  'missed',
  'timed',
  'custom',
  'mock',
  'review',
  'checkpoint',
] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

const enrollmentSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    examId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    examDate: { type: String, match: DATE_RE, default: null },
    status: { type: String, required: true, enum: ['active', 'paused', 'passed', 'archived'], default: 'active' },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date },
  },
  opts,
);
enrollmentSchema.index({ userId: 1, examVersionId: 1 }, { unique: true });
enrollmentSchema.index({ userId: 1, status: 1 });
export const Enrollment = model('Enrollment', enrollmentSchema);

const lessonProgressSchema = new Schema(
  {
    enrollmentId: { type: String, required: true },
    userId: { type: String, required: true },
    lessonId: { type: String, required: true },
    state: { type: String, required: true, enum: ['in_progress', 'completed', 'placed_out'] },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  opts,
);
lessonProgressSchema.index({ enrollmentId: 1, lessonId: 1 }, { unique: true });
export const LessonProgress = model('LessonProgress', lessonProgressSchema);

const sessionItemSchema = new Schema(
  {
    _id: uuidId,
    questionVersionId: { type: String, required: true },
    familyId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    domainId: { type: String, required: true },
    position: { type: Number, required: true, min: 1 },
    /** True when no unseen family was available and a seen one was reused. */
    repeat: { type: Boolean, default: false },
  },
  { _id: false },
);

const practiceSessionSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    enrollmentId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    lessonId: { type: String, default: null },
    mode: { type: String, required: true, enum: SESSION_MODES },
    status: { type: String, required: true, enum: ['active', 'completed', 'expired', 'abandoned'], default: 'active' },
    questionCount: { type: Number, required: true, min: 1, max: 200 },
    clientSessionId: { type: String, required: true },
    /** Bounded selection facts, including the entitlement admission snapshot. */
    selectionConfig: { type: Schema.Types.Mixed, default: {} },
    items: { type: [sessionItemSchema], default: [] },
    startedAt: { type: Date, required: true, default: Date.now },
    deadlineAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    /** Touched at the start of every write transaction to serialize concurrent writers. */
    lockVersion: { type: Number, default: 0 },
    /** Stable completion summary returned on every retry. */
    completion: { type: Schema.Types.Mixed, default: null },
    qualifying: { type: Boolean, default: false },
  },
  { ...opts, minimize: false },
);
practiceSessionSchema.index({ userId: 1, clientSessionId: 1 }, { unique: true });
practiceSessionSchema.index({ userId: 1, status: 1, startedAt: -1 });
practiceSessionSchema.index({ status: 1, deadlineAt: 1 });
practiceSessionSchema.index({ enrollmentId: 1, mode: 1, completedAt: -1 });
export const PracticeSession = model('PracticeSession', practiceSessionSchema);

const attemptSchema = new Schema(
  {
    _id: uuidId,
    sessionId: { type: String, required: true },
    sessionItemId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    enrollmentId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    questionVersionId: { type: String, required: true },
    familyId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    domainId: { type: String, required: true },
    mode: { type: String, required: true, enum: SESSION_MODES },
    clientSubmissionId: { type: String, required: true },
    selectedOptions: { type: [String], required: true },
    confidence: { type: String, enum: ['unsure', 'somewhat', 'confident'], default: null },
    reasoningText: { type: String, maxlength: 2000, default: null },
    submittedAt: { type: Date, required: true, default: Date.now },
    gradedAt: { type: Date, default: null },
    isCorrect: { type: Boolean, default: null },
    firstSeenFamily: { type: Boolean, default: false },
    /** Set by a content repair when the question revision is invalidated. */
    invalidatedAt: { type: Date, default: null },
  },
  opts,
);
attemptSchema.index({ userId: 1, clientSubmissionId: 1 }, { unique: true });
attemptSchema.index({ userId: 1, examVersionId: 1, gradedAt: -1 });
attemptSchema.index({ sessionId: 1 });
attemptSchema.index({ questionVersionId: 1 });
export const Attempt = model('Attempt', attemptSchema);

const exposureSchema = new Schema(
  {
    userId: { type: String, required: true },
    familyId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    answeredCount: { type: Number, required: true, default: 0, min: 0 },
  },
  opts,
);
exposureSchema.index({ userId: 1, familyId: 1 }, { unique: true });
exposureSchema.index({ userId: 1, examVersionId: 1 });
export const QuestionExposure = model('QuestionExposure', exposureSchema);

const objectiveProgressSchema = new Schema(
  {
    enrollmentId: { type: String, required: true },
    userId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    firstSeenTotal: { type: Number, default: 0, min: 0 },
    firstSeenCorrect: { type: Number, default: 0, min: 0 },
    totalAttempts: { type: Number, default: 0, min: 0 },
    totalCorrect: { type: Number, default: 0, min: 0 },
    lastPracticedAt: { type: Date },
  },
  opts,
);
objectiveProgressSchema.index({ enrollmentId: 1, objectiveId: 1 }, { unique: true });
export const ObjectiveProgress = model('ObjectiveProgress', objectiveProgressSchema);

const reviewHistorySchema = new Schema(
  {
    at: { type: Date, required: true },
    priorStage: { type: Number, required: true },
    correct: { type: Boolean, required: true },
    familyId: { type: String, required: true },
    attemptId: { type: String, required: true },
    nextStage: { type: Number, required: true },
    nextDueAt: { type: Date, required: true },
  },
  { _id: false },
);

const reviewQueueSchema = new Schema(
  {
    _id: uuidId,
    enrollmentId: { type: String, required: true },
    userId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    sourceAttemptId: { type: String },
    reason: { type: String, required: true, enum: ['missed', 'spacing', 'checkpoint'] },
    stage: { type: Number, required: true, min: 0, max: 4, default: 0 },
    dueAt: { type: Date, required: true },
    lastReviewedAt: { type: Date },
    /** Reproducibility log: prior stage, graded response, family and next due date. */
    history: { type: [reviewHistorySchema], default: [] },
  },
  opts,
);
reviewQueueSchema.index({ enrollmentId: 1, objectiveId: 1 }, { unique: true });
reviewQueueSchema.index({ userId: 1, dueAt: 1 });
export const ReviewQueue = model('ReviewQueue', reviewQueueSchema);

const examOutcomeSchema = new Schema(
  {
    _id: uuidId,
    enrollmentId: { type: String, required: true },
    userId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    result: { type: String, required: true, enum: ['passed', 'failed'] },
    takenAt: { type: Date, required: true },
    verificationStatus: {
      type: String,
      required: true,
      enum: ['self_reported', 'evidence_received', 'verified'],
      default: 'self_reported',
    },
    privateEvidenceRef: { type: String, default: null },
    verifiedBy: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    clientRequestId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
examOutcomeSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
examOutcomeSchema.index({ userId: 1, takenAt: -1 });
export const ExamOutcome = model('ExamOutcome', examOutcomeSchema);

export const ISSUE_REASONS = ['incorrect_key', 'unclear', 'outdated', 'typo', 'other'] as const;

const issueReportSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    questionVersionId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    attemptId: { type: String, default: null },
    reason: { type: String, required: true, enum: ISSUE_REASONS },
    note: { type: String, maxlength: 1000, default: '' },
    status: { type: String, required: true, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
    resolution: { type: String, default: '' },
    resolvedBy: { type: String },
    resolvedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
issueReportSchema.index({ status: 1, createdAt: -1 });
issueReportSchema.index({ userId: 1, questionVersionId: 1 });
export const IssueReport = model('IssueReport', issueReportSchema);
