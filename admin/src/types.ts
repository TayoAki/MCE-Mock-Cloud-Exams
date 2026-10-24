/** Response shapes from api/src/services/content-admin.ts, admin-ops.ts and account.ts. */

export type Role = 'learner' | 'reviewer' | 'admin';

export interface Profile {
  id: string;
  display_name: string;
  email: string | null;
  is_guest: boolean;
  roles: Role[];
  timezone: string;
  pending_timezone: { zone: string; effective_at: string } | null;
  daily_goal_minutes: number;
  deletion_requested_at: string | null;
  created_at?: string;
}

export interface Overview {
  window_days: number;
  learners_total: number;
  new_learners: number;
  activation: { activated: number; cohort: number };
  weekly_active_study: { learners: number; of_total: number };
  study_days_credited: number;
  answers_submitted: number;
  sessions_by_mode: { mode: string; sessions: number }[];
  questions_by_status: Partial<Record<'draft' | 'published' | 'retired', number>>;
  open_issues: number;
  preview_starts: number;
  outcomes: { result: 'passed' | 'failed'; verification_status: string; count: number }[];
  events: { event: string; count: number }[];
}

export type ExamStatus = 'planned' | 'pilot' | 'active' | 'retired';
export type PublicationStatus = 'draft' | 'published' | 'retired';

export interface ExamRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  provider: 'aws' | 'databricks' | 'microsoft';
  status: ExamStatus;
  canonical_url: string;
  versions: { id: string; version_label: string; status: PublicationStatus; effective_from: string }[];
}

export interface ObjectiveRow {
  id: string;
  code: string;
  title: string;
  published: number;
  drafts: number;
}

export interface DomainRow {
  id: string;
  code: string;
  title: string;
  weight_percent: number;
  sort_order: number;
  objectives: ObjectiveRow[];
}

export interface LessonRow {
  id: string;
  title: string;
  summary: string;
  kind: 'learn' | 'review' | 'checkpoint';
  status: PublicationStatus;
  question_count: number;
  sort_order: number;
  objective_ids: string[];
  pool_family_ids: string[];
}

export interface UnitRow {
  id: string;
  title: string;
  subtitle: string;
  sort_order: number;
  lessons: LessonRow[];
}

export interface ReadinessCheck {
  key: string;
  blocking: boolean;
  ok: boolean;
  detail: string;
}

export interface VersionDetail {
  id: string;
  exam: { id: string; title: string; status: ExamStatus } | null;
  version_label: string;
  status: PublicationStatus;
  effective_from: string;
  question_count: number;
  duration_minutes: number;
  guide_url: string;
  domains: DomainRow[];
  units: UnitRow[];
  readiness: { ready: boolean; checks: ReadinessCheck[]; published_questions: number };
}

export interface FamilyRow {
  id: string;
  family_key: string;
  objective_id: string;
  latest_revision: number | null;
  latest_status: PublicationStatus | null;
  has_published: boolean;
  prompt: string;
}

export interface QuestionRow {
  id: string;
  exam_version_id: string;
  family_id: string;
  revision: number;
  prompt: string;
  status: PublicationStatus;
  answer_type: 'single' | 'multiple';
  objective_id: string;
  domain_id: string;
  reviewed: boolean;
  created_at: string;
  family_key: string;
  open_issues: number;
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface QuestionDetail extends Omit<QuestionRow, 'open_issues'> {
  difficulty: number;
  options: QuestionOption[];
  source_url: string;
  correct_options: string[];
  rationale: string;
  reviewed_notes: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  published_at: string | null;
  revisions: { id: string; revision: number; status: PublicationStatus; created_at: string }[];
  audit: { action: string; actor_id: string; actor: string; note: string; recorded_at: string }[];
  issues: { id: string; reason: string; note: string; status: string; created_at: string }[];
  attempts: { total: number; correct: number };
  repaired_enrollments?: number;
}

export interface QuestionInput {
  prompt: string;
  answer_type: 'single' | 'multiple';
  options: QuestionOption[];
  correct_options: string[];
  rationale: string;
  source_url: string;
  reviewed_notes?: string;
}

export type IssueStatus = 'open' | 'resolved' | 'dismissed';

export interface IssueRow {
  id: string;
  question_version_id: string;
  question_prompt: string;
  question_status: string;
  reason: string;
  note: string;
  status: IssueStatus;
  resolution: string;
  created_at: string;
  resolved_at: string | null;
}

export const FEATURES = ['full_bank', 'custom_quiz', 'mocks', 'ai_explain'] as const;
export type FeatureKey = (typeof FEATURES)[number];

export interface LearnerDetail {
  user: Profile;
  streak: {
    current: number;
    longest: number;
    last_study_date: string | null;
    studied_today: boolean;
    today: string;
    week: { date: string; studied: boolean; is_today: boolean }[];
  };
  xp_total: number;
  enrollments: { id: string; exam_version_id: string; status: string; exam_date: string | null }[];
  entitlements: {
    id: string;
    feature_key: FeatureKey;
    source: 'preview' | 'store' | 'manual';
    starts_at: string;
    ends_at: string;
    source_ref?: string;
    revoked_at: string | null;
  }[];
  outcomes: { id: string; result: 'passed' | 'failed'; taken_at: string; verification_status: VerificationStatus }[];
  recent_sessions: { id: string; mode: string; status: string; started_at: string; question_count: number; correct: number | null }[];
}

export type VerificationStatus = 'self_reported' | 'evidence_received' | 'verified';

export interface OutcomeRow {
  id: string;
  learner: string;
  user_id: string;
  result: 'passed' | 'failed';
  taken_at: string;
  verification_status: VerificationStatus;
}

export interface AuditEntry {
  id: string;
  actor: string;
  entity_type: string;
  entity_id: string;
  action: string;
  note: string;
  details: Record<string, unknown>;
  recorded_at: string;
}

export interface StaffRow {
  id: string;
  display_name: string;
  email: string | null;
  roles: Role[];
  created_at: string;
}

/** The seed's system reviewer: marks dev fixtures, never a human review. */
export const FIXTURE_REVIEWER_ID = '00000000-0000-4000-8000-00000000f1f0';
