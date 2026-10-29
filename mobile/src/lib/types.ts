/** Response shapes from the CertPath API (api/src/routes). */

export type FeatureKey = 'full_bank' | 'custom_quiz' | 'mocks' | 'ai_explain';
export type SessionMode =
  | 'lesson'
  | 'quick'
  | 'weakest'
  | 'missed'
  | 'timed'
  | 'custom'
  | 'mock'
  | 'review'
  | 'checkpoint'
  | 'story'
  | 'qotd'
  | 'flagged'
  | 'levelup';

/** single/multiple: choose; order: tap into sequence; match: pair items; type: type or say a short answer. */
export type AnswerType = 'single' | 'multiple' | 'order' | 'match' | 'type';

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
  /** Remind at the time this learner usually studies instead of `daily_local_time`. */
  smart_timing: boolean;
  /** A last-call reminder in the evening when a streak is at stake. */
  streak_saver: boolean;
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
    week: WeekDay[];
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
  /** Choices, the correct sequence for order questions, or "A=2" pairs for match. */
  correct_options: string[];
  /** The model answer for typed questions. */
  expected_answer?: string | null;
  rationale: string;
  sources: string[];
}

/** How learners did on a question on their first try; the percentage appears from five learners. */
export interface PeerStat {
  correct_percent: number | null;
  answered: number;
}

/** A question's rating: the learner's own stars and, once enough learners rated, the average. */
export interface RatingView {
  mine: number | null;
  average: number | null;
  count: number;
}

export interface SessionItem {
  session_item_id: string;
  question_version_id: string;
  family_id: string;
  position: number;
  prompt: string;
  answer_type: AnswerType;
  options: { key: string; text: string }[];
  /** The right-hand column of a match question. */
  match_targets?: { key: string; text: string }[];
  /** 'listen' reads the prompt aloud first. */
  presentation?: 'text' | 'listen';
  input_hint?: string | null;
  objective_title: string;
  domain_title: string;
  repeat: boolean;
  /** Bookmarked by the learner to come back to. */
  flagged: boolean;
  submission: {
    attempt_id: string;
    selected_options: string[];
    typed_answer?: string | null;
    submitted_at: string;
    feedback: Feedback | null;
    peer?: PeerStat | null;
    rating?: RatingView | null;
  } | null;
}

export type StoryPart = { kind: 'line'; speaker: string | null; text: string } | { kind: 'question'; session_item_id: string };

export interface StorySummary {
  id: string;
  title: string;
  summary: string;
  characters: { name: string; role: string }[];
  question_count: number;
  completed: boolean;
  active_session_id: string | null;
}

export interface DomainResult {
  domain_id: string;
  title: string;
  correct: number;
  total: number;
}

export interface WeekDay {
  date: string;
  studied: boolean;
  /** A missed day a freeze, the weekend amulet or a repair covered. */
  protected?: 'freeze' | 'amulet' | 'repair' | null;
  is_today: boolean;
}

export type LeagueTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'lakehouse';

export interface Level {
  level: number;
  title: string;
  xp: number;
  floor: number;
  next: number;
}

export interface Quest {
  key: string;
  label: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface Celebration {
  id: string;
  kind:
    | 'level_up'
    | 'achievement'
    | 'streak_milestone'
    | 'quest_complete'
    | 'quests_done'
    | 'monthly_challenge'
    | 'freeze_used'
    | 'amulet_used'
    | 'streak_broken'
    | 'streak_repaired'
    | 'wager_won'
    | 'wager_lost'
    | 'league_result'
    | 'friend_streak'
    | 'high_five'
    | 'nudge'
    | 'circle_quest'
    | 'levelup_passed';
  payload: Record<string, string | number | null>;
  created_at: string;
}

export interface LeagueStanding {
  tier: LeagueTier;
  rank: number;
  previous_rank: number | null;
  size: number;
  xp: number;
  week_start: string;
  ends_at: string;
  promote: number;
  demote: number;
}

export interface EngagementSummary {
  accuracy: number;
  duration_seconds: number | null;
  gems_earned: number;
  gems_total: number;
  level: Level & { leveled_up: boolean };
  quests: Quest[];
  chest_available: boolean;
  league: LeagueStanding | null;
  celebrations: Celebration[];
}

export type ShopItem = 'streak_freeze' | 'weekend_amulet' | 'streak_repair' | 'streak_wager';

export interface Engagement {
  gems: number;
  freezes: number;
  max_freezes: number;
  amulet: { saturday: string; sunday: string } | null;
  wager: { started_on: string; ends_on: string; stake: number; payout: number; status: 'active' | 'won' | 'lost' } | null;
  boost_until: string | null;
  repair: { days: number; until: string; price: number } | null;
  level: Level;
  league: { tier: LeagueTier; hidden: boolean };
  prices: Record<ShopItem, number>;
}

export type ChestReward = { kind: 'gems'; amount: number } | { kind: 'xp_boost'; minutes: number; until: string } | { kind: 'streak_freeze' };

export interface QuestsView {
  date: string;
  quests: Quest[];
  chest: { available: boolean; opened: boolean; reward: ChestReward | null };
  monthly: { month: string; target: number; progress: number };
}

export interface Badge {
  key: string;
  title: string;
  description: string;
  icon: string;
  group: 'habit' | 'learning' | 'practice' | 'social' | 'league';
  earned_at: string | null;
}

export interface LeagueView {
  tier: LeagueTier;
  tiers: LeagueTier[];
  hidden: boolean;
  joined: boolean;
  week_start: string;
  ends_at: string;
  promote: number;
  demote: number;
  rows: { rank: number; name: string; xp: number; is_me: boolean; zone: 'promote' | 'demote' | null }[];
  last_result: { week_start: string; tier: LeagueTier; rank: number | null; outcome: 'promoted' | 'demoted' | 'stayed' | null } | null;
}

export interface FriendStreakRow {
  id: string;
  friend: { id: string; name: string };
  status: 'pending' | 'active';
  invited_by_me: boolean;
  current: number;
  longest: number;
  me_today: boolean;
  friend_today: boolean;
}

export interface CircleActivity {
  quest: { target: number; progress: number; done: boolean; ends_at: string; reward_gems: number };
  members: { user_id: string; name: string; is_you: boolean; weekly_xp: number; studied_today: boolean; high_fived_today: boolean }[];
  feed: { user_id: string; name: string; is_you: boolean; kind: 'lesson_completed'; at: string }[];
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
  /** Present for sessions finished after gamification shipped. */
  engagement?: EngagementSummary;
  level_up?: LevelUpResult | null;
  qotd?: { date: string; correct: boolean; streak: number; longest: number } | null;
}

export interface LevelUpResult {
  domain_id: string;
  domain_title: string;
  level: number;
  label: string;
  passed: boolean;
  newly_passed: boolean;
  correct: number;
  total: number;
  needed: number;
  next_level: { level: number; label: string } | null;
  mastered: boolean;
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
  /** Mocks and timed quizzes open the tutor only after an answer is in. */
  tutor?: 'any_time' | 'after_answer';
  level_up?: { domain_id: string; level: number; label: string; pass_needed: number } | null;
  qotd_date?: string | null;
  items: SessionItem[];
  completion: Completion | null;
  story?: { id: string; title: string; characters: { name: string; role: string }[]; parts: StoryPart[] } | null;
}

export interface AnswerReceipt {
  attempt_id: string;
  accepted: boolean;
  feedback: Feedback | null;
  peer?: PeerStat | null;
  rating?: RatingView | null;
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
    answer_type?: AnswerType;
    options: { key: string; text: string }[];
    match_targets?: { key: string; text: string }[];
    selected_options: string[];
    typed_answer?: string | null;
    attempt_id: string | null;
    answered: boolean;
    family_id?: string;
    question_version_id?: string;
    flagged?: boolean;
    feedback: Feedback;
    peer?: PeerStat | null;
    rating?: RatingView | null;
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

export interface CertScore {
  score: number;
  band: string;
  max: number;
  /** Change since the latest score at least a week old. */
  delta_7d: number | null;
  history: { date: string; score: number }[];
  domains: { domain_id: string; title: string; weight_percent: number; score: number; objectives_practiced: number; objectives_total: number }[];
  strongest: string | null;
  focus: { domain_id: string; title: string } | null;
  method: string;
  note: string;
}

export interface Recap {
  period: { kind: 'month' | 'year'; label: string; start: string; end: string };
  empty: boolean;
  study_days: number;
  days_in_period: number;
  longest_streak: number;
  answered: number;
  accuracy: number | null;
  xp: number;
  gems: number;
  minutes: number;
  lessons: number;
  stories: number;
  mocks: number;
  best_day: { date: string; xp: number } | null;
  top_domain: string | null;
  persona: { key: string; title: string; body: string };
  badges: string[];
  league: { best_rank: number; tier: LeagueTier; promotions: number } | null;
  high_fives: number;
  score: { start: number; end: number } | null;
  share_text: string;
}

export interface QotdView {
  date: string;
  available: boolean;
  question: { prompt: string; answer_type: AnswerType; objective_title: string; domain_title: string } | null;
  status: 'new' | 'in_progress' | 'done';
  session_id: string | null;
  result: { correct: boolean; peer: PeerStat | null } | null;
  streak: { current: number; longest: number; answered_today: boolean };
  gems: number;
}

export interface FlagItem {
  family_id: string;
  question_version_id: string;
  prompt: string;
  answer_type: AnswerType;
  objective_title: string;
  domain_title: string;
  flagged_at: string;
  last_correct: boolean | null;
  /** False while the question is retired or under repair. */
  available: boolean;
}

export interface FlagsView {
  enrollment_id: string;
  items: FlagItem[];
  quiz_available: number;
}

export interface LevelUpDomain {
  domain_id: string;
  title: string;
  weight_percent: number;
  level_passed: number;
  current_level: number;
  label: string;
  mastered: boolean;
  question_count: number;
  available: boolean;
  /** Has questions, but the learner's plan or path doesn't reach them yet. */
  locked: boolean;
  by_difficulty: number[];
  best: Record<string, number>;
  attempts: number;
}

export interface LevelUpView {
  enrollment_id: string;
  levels: { level: number; label: string }[];
  domains: LevelUpDomain[];
}

export interface Suggestion {
  kind: 'take_break' | 'level_up' | 'retry_missed' | 'review_due' | 'qotd' | 'next_lesson' | 'flagged' | 'weakest';
  title: string;
  body: string;
  cta: string;
  start: { mode: SessionMode; lesson_id?: string; domain_ids?: string[]; source_session_id?: string } | null;
}

export interface NextSteps {
  session_id: string;
  primary: Suggestion;
  secondary: Suggestion | null;
  studied_minutes_today: number;
}

export interface TutorMessage {
  role: 'learner' | 'tutor';
  text: string;
  phase: 'before' | 'after';
  origin: 'generated' | 'hint' | null;
  at: string;
}

export interface TutorThread {
  session_item_id: string;
  session_id: string;
  phase: 'before' | 'after';
  available: boolean;
  /** 'hints' when AI isn't configured: reviewed hints and explanations only. */
  mode: 'ai' | 'hints';
  intro: string;
  suggestions: string[];
  remaining: number;
  messages: TutorMessage[];
}
