import { Schema, model } from 'mongoose';
import { DATE_RE, opts, uuidId } from './common.js';

/** The day's shared question for an exam version, picked once and kept for everyone on that date. */
const dailyQuestionSchema = new Schema(
  {
    examVersionId: { type: String, required: true },
    date: { type: String, required: true, match: DATE_RE },
    familyId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
dailyQuestionSchema.index({ examVersionId: 1, date: 1 }, { unique: true });
export const DailyQuestion = model('DailyQuestion', dailyQuestionSchema);

/** The Question of the Day streak, separate from the study streak: a day counts when its question is answered. */
const qotdStreakSchema = new Schema(
  {
    _id: { type: String, required: true }, // user id
    currentDays: { type: Number, required: true, default: 0, min: 0 },
    longestDays: { type: Number, required: true, default: 0, min: 0 },
    lastDate: { type: String, match: DATE_RE, default: null },
    answered: { type: Number, required: true, default: 0, min: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  opts,
);
export const QotdStreak = model('QotdStreak', qotdStreakSchema);

/** A learner's bookmark on a question family, so later revisions stay flagged. */
const flaggedQuestionSchema = new Schema(
  {
    userId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    familyId: { type: String, required: true },
    /** The revision the learner flagged, for the list when the family has no published revision. */
    questionVersionId: { type: String, required: true },
    flaggedAt: { type: Date, required: true, default: Date.now },
  },
  opts,
);
flaggedQuestionSchema.index({ userId: 1, familyId: 1 }, { unique: true });
flaggedQuestionSchema.index({ userId: 1, examVersionId: 1, flaggedAt: -1 });
export const FlaggedQuestion = model('FlaggedQuestion', flaggedQuestionSchema);

/** Level Up progress per exam domain: levels 1–3 follow question difficulty, level 4 is mastery. */
const levelUpSchema = new Schema(
  {
    enrollmentId: { type: String, required: true },
    userId: { type: String, required: true },
    domainId: { type: String, required: true },
    levelPassed: { type: Number, required: true, default: 0, min: 0, max: 4 },
    /** Best correct count per level, keyed by level number. */
    best: { type: Schema.Types.Mixed, default: {} },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { ...opts, minimize: false },
);
levelUpSchema.index({ enrollmentId: 1, domainId: 1 }, { unique: true });
export const LevelUpProgress = model('LevelUpProgress', levelUpSchema);

const tutorMessageSchema = new Schema(
  {
    role: { type: String, required: true, enum: ['learner', 'tutor'] },
    text: { type: String, required: true, maxlength: 4000 },
    /** Before the learner answered (guide only) or after (free discussion). */
    phase: { type: String, required: true, enum: ['before', 'after'] },
    origin: { type: String, enum: ['generated', 'hint', null], default: null },
    clientMessageId: { type: String, default: null },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

/** A conversation with the tutor about one question in one session. */
const tutorThreadSchema = new Schema(
  {
    _id: uuidId,
    userId: { type: String, required: true },
    sessionId: { type: String, required: true },
    sessionItemId: { type: String, required: true },
    questionVersionId: { type: String, required: true },
    examVersionId: { type: String, required: true },
    messages: { type: [tutorMessageSchema], default: [] },
    /** How far down the reviewed hint ladder the fallback tutor has gone. */
    hintsGiven: { type: Number, required: true, default: 0, min: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  opts,
);
tutorThreadSchema.index({ userId: 1, sessionItemId: 1 }, { unique: true });
export const TutorThread = model('TutorThread', tutorThreadSchema);
