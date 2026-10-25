/** Response shapes from the CertPath API (api/src/routes). */

export type FeatureKey = 'full_bank' | 'custom_quiz' | 'mocks' | 'ai_explain';
export type SessionMode = 'lesson' | 'quick' | 'weakest' | 'missed' | 'timed' | 'custom' | 'mock' | 'review' | 'checkpoint';

export interface Profile {
  id: string;
  display_name: string;
  email: string | null;
  is_guest: boolean;
  roles: string[];
  timezone: string;
  pending_timezone: { zone: string; effective_at: string } | null;
  daily_goal_minutes: number;
  deletion_requested_at: string | null;
}

export interface Entitlement {
  feature_key: FeatureKey;
  source: 'preview' | 'store' | 'manual';
  starts_at: string;
  ends_at: string;
}

export interface Preferences {
  reminders_enabled: boolean;
  daily_local_time: string;
  quiet_start: string;
  quiet_end: string;
  weekly_circle_summary: boolean;
}

export interface EnrollmentSummary {
  id: string;
  exam_id: string;
  exam_version_id: string;
  status: 'active' | 'paused' | 'passed' | 'archived';
  exam_date: string | null;
  newer_version_id: string | null;
}

export interface Me {
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
  entitlements: Entitlement[];
  /** False while CertPath is free: every learner has every feature and nothing is for sale. */
  plus_enabled: boolean;
  plus_active: boolean;
  plus_ends_at: string | null;
  preview_used: boolean;
  preferences: Preferences;
  enrollments: EnrollmentSummary[];
}

export interface Exam {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  provider: 'aws' | 'databricks' | 'microsoft';
  status: 'planned' | 'pilot' | 'active' | 'retired';
  enrollable: boolean;
  current_version_id: string | null;
  current_version: { id: string; version_label: string; question_count: number; duration_minutes: number; guide_url: string } | null;
}

export interface LessonNode {
  id: string;
  title: string;
  summary: string;
  kind: 'learn' | 'review' | 'checkpoint';
  state: 'locked' | 'available' | 'in_progress' | 'completed' | 'placed_out';
  question_count: number;
  unit_id: string;
  unit_title: string;
  active_session_id: string | null;
}

export interface Path {
  enrollment_id: string;
  current_lesson_id: string | null;
  lessons: LessonNode[];
  units: { id: string; title: string; subtitle: string; lesson_ids: string[] }[];
}

export interface Feedback {
  correct: boolean;
  correct_options: string[];
  rationale: string;
  sources: string[];
}

export interface SessionItem {
  session_item_id: string;
  question_version_id: string;
  position: number;
  prompt: string;
  answer_type: 'single' | 'multiple';
  options: { key: string; text: string }[];
  objective_title: string;
  domain_title: string;
  repeat: boolean;
  submission: { attempt_id: string; selected_options: string[]; submitted_at: string; feedback: Feedback | null } | null;
}

export interface DomainResult {
  domain_id: string;
  title: string;
  correct: number;
  total: number;
}

export interface Completion {
  session_id: string;
  mode: SessionMode;
  status: 'completed' | 'expired';
  correct: number;
  total: number;
  answered: number;
  xp_granted: number;
  study_day_credited: boolean;
  current_streak: number;
  domains: DomainResult[];
  practice_score_note: string;
  sample: boolean;
  fresh_count: number | null;
  lesson_id: string | null;
  completed_at: string;
}

export interface Session {
  id: string;
  mode: SessionMode;
  status: 'active' | 'completed' | 'expired' | 'abandoned';
  enrollment_id: string;
  lesson: { id: string; title: string; unit_title: string } | null;
  deadline_at: string | null;
  started_at: string;
  server_time: string;
  question_count: number;
  answered_count: number;
  sample: boolean;
  feedback_timing: 'per_answer' | 'after_submit';
  items: SessionItem[];
  completion: Completion | null;
}

export interface AnswerReceipt {
  attempt_id: string;
  accepted: boolean;
  feedback: Feedback | null;
  xp_granted?: number;
}

export interface ActiveSession {
  id: string;
  mode: SessionMode;
  enrollment_id: string;
  lesson_id: string | null;
  question_count: number;
  answered_count: number;
  deadline_at: string | null;
  started_at: string;
  sample: boolean;
}

export interface PracticeSummary {
  enrollment_id: string;
  due_review_count: number;
  missed_count: number;
  mock: {
    full_form_size: number;
    duration_minutes: number;
    full_form_available: boolean;
    published_questions: number;
    sample_size: number;
    sample_minutes: number;
  };
  features: FeatureKey[];
  active_sessions: ActiveSession[];
}

export interface ReviewEntry {
  objective_id: string;
  title: string;
  domain_title: string;
  due_at: string;
  stage: number;
  due: boolean;
  reason: string;
}

export interface Reviews {
  enrollment_id: string;
  due_count: number;
  missed_count: number;
  due: ReviewEntry[];
  upcoming: ReviewEntry[];
}

export interface Progress {
  enrollment_id: string;
  practiced_objectives: number;
  total_objectives: number;
  first_seen_correct: number;
  first_seen_total: number;
  repeat_correct: number;
  repeat_total: number;
  latest_mock: Completion | null;
  mock_history: Completion[];
  domains: {
    domain_id: string;
    title: string;
    weight_percent: number;
    first_seen_correct: number;
    first_seen_total: number;
    objectives_practiced: number;
    objectives_total: number;
    enough_practice: boolean;
  }[];
  focus: {
    objective_id: string;
    title: string;
    domain_id: string;
    reason: 'low_accuracy' | 'coverage_gap';
    first_seen_correct: number;
    first_seen_total: number;
  } | null;
  min_ranking_sample: number;
  note: string;
}

export interface Explanation {
  origin: 'generated' | 'reviewed_fallback';
  text: string;
  sources: string[];
  notice: string | null;
}

export interface SessionFeedback {
  session_id: string;
  status: string;
  items: {
    session_item_id: string;
    position: number;
    prompt: string;
    options: { key: string; text: string }[];
    selected_options: string[];
    attempt_id: string | null;
    answered: boolean;
    feedback: Feedback;
  }[];
}

export interface Circle {
  id: string;
  name: string;
  timezone: string;
  weekly_target_days: number;
  week_starts_at: string;
  week_ends_at: string;
  members: { display_name: string; study_days: number; is_you: boolean; role: 'owner' | 'member' }[];
  note: string;
}
