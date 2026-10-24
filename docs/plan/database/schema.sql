-- CertPath v2: PostgreSQL reference migration.
-- API-only access. Do not expose these schemas directly to the mobile client.
-- No infrastructure or production database is created by this file.
BEGIN;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE app.user_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 external_subject text NOT NULL UNIQUE,
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
 timezone text NOT NULL DEFAULT 'Etc/UTC',
 daily_goal_minutes integer NOT NULL DEFAULT 5 CHECK (daily_goal_minutes BETWEEN 5 AND 60),
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE TABLE app.exams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE,
 provider text NOT NULL CHECK (provider IN ('aws','databricks','microsoft')),
 title text NOT NULL,
 status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','pilot','active','retired')),
 canonical_url text NOT NULL
);
CREATE TABLE app.exam_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_id uuid NOT NULL REFERENCES app.exams(id),
 version_label text NOT NULL,
 effective_from date NOT NULL,
 effective_until date,
 question_count integer NOT NULL CHECK (question_count > 0),
 duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
 guide_url text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
 UNIQUE (exam_id,version_label),
 UNIQUE (id,exam_id),
 CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE TABLE app.domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_version_id uuid NOT NULL REFERENCES app.exam_versions(id),
 code text NOT NULL,
 title text NOT NULL,
 weight_percent numeric(5,2) NOT NULL CHECK (weight_percent BETWEEN 0 AND 100),
 sort_order integer NOT NULL CHECK (sort_order > 0),
 UNIQUE (exam_version_id,code),
 UNIQUE (id,exam_version_id)
);
CREATE TABLE app.objectives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_version_id uuid NOT NULL,
 domain_id uuid NOT NULL,
 code text NOT NULL,
 title text NOT NULL,
 FOREIGN KEY (domain_id,exam_version_id) REFERENCES app.domains(id,exam_version_id),
 UNIQUE (exam_version_id,code),
 UNIQUE (id,exam_version_id)
);
CREATE TABLE app.units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_version_id uuid NOT NULL REFERENCES app.exam_versions(id),
 title text NOT NULL,
 sort_order integer NOT NULL CHECK (sort_order > 0),
 UNIQUE (exam_version_id,sort_order),
 UNIQUE (id,exam_version_id)
);
CREATE TABLE app.lessons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_version_id uuid NOT NULL,
 unit_id uuid NOT NULL,
 title text NOT NULL,
 kind text NOT NULL DEFAULT 'learn' CHECK (kind IN ('learn','review','checkpoint')),
 question_count integer NOT NULL DEFAULT 5 CHECK (question_count BETWEEN 1 AND 50),
 sort_order integer NOT NULL CHECK (sort_order > 0),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
 FOREIGN KEY (unit_id,exam_version_id) REFERENCES app.units(id,exam_version_id),
 UNIQUE (unit_id,sort_order),
 UNIQUE (id,exam_version_id)
);
CREATE TABLE app.lesson_objectives (
 lesson_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 objective_id uuid NOT NULL,
 PRIMARY KEY (lesson_id,objective_id),
 FOREIGN KEY (lesson_id,exam_version_id) REFERENCES app.lessons(id,exam_version_id),
 FOREIGN KEY (objective_id,exam_version_id) REFERENCES app.objectives(id,exam_version_id)
);
CREATE TABLE app.question_families (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_version_id uuid NOT NULL,
 objective_id uuid NOT NULL,
 family_key text NOT NULL,
 difficulty integer NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3),
 FOREIGN KEY (objective_id,exam_version_id) REFERENCES app.objectives(id,exam_version_id),
 UNIQUE (exam_version_id,family_key),
 UNIQUE (id,exam_version_id)
);
CREATE TABLE app.question_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 family_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 revision integer NOT NULL CHECK (revision > 0),
 prompt_markdown text NOT NULL CHECK (length(prompt_markdown) >= 10),
 answer_type text NOT NULL DEFAULT 'single' CHECK (answer_type IN ('single','multiple')),
 source_url text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
 reviewed_by uuid REFERENCES app.user_profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (family_id,exam_version_id) REFERENCES app.question_families(id,exam_version_id),
 UNIQUE (family_id,revision),
 UNIQUE (id,exam_version_id),
 CHECK (status <> 'published' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE app.question_options (
 question_version_id uuid NOT NULL REFERENCES app.question_versions(id),
 option_key text NOT NULL CHECK (option_key ~ '^[A-Z]$'),
 body text NOT NULL,
 sort_order integer NOT NULL CHECK (sort_order > 0),
 PRIMARY KEY (question_version_id,option_key),
 UNIQUE (question_version_id,sort_order)
);
-- Correct options and rationales are not part of the question delivery payload.
CREATE TABLE private.question_explanations (
 question_version_id uuid PRIMARY KEY REFERENCES app.question_versions(id),
 rationale_markdown text NOT NULL,
 reviewed_notes text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.correct_options (
 question_version_id uuid NOT NULL,
 option_key text NOT NULL,
 PRIMARY KEY (question_version_id,option_key),
 FOREIGN KEY (question_version_id,option_key)
   REFERENCES app.question_options(question_version_id,option_key)
);
CREATE TABLE app.lesson_question_pool (
 lesson_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 family_id uuid NOT NULL,
 sort_order integer NOT NULL CHECK (sort_order > 0),
 PRIMARY KEY (lesson_id,family_id),
 FOREIGN KEY (lesson_id,exam_version_id) REFERENCES app.lessons(id,exam_version_id),
 FOREIGN KEY (family_id,exam_version_id) REFERENCES app.question_families(id,exam_version_id),
 UNIQUE (lesson_id,sort_order)
);
CREATE TABLE app.enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 exam_version_id uuid NOT NULL REFERENCES app.exam_versions(id),
 exam_date date,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','passed','archived')),
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 UNIQUE (user_id,exam_version_id),
 UNIQUE (id,user_id,exam_version_id)
);
CREATE TABLE app.lesson_progress (
 enrollment_id uuid NOT NULL,
 user_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 lesson_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'available' CHECK (state IN ('available','in_progress','completed','placed_out')),
 completed_at timestamptz,
 PRIMARY KEY (enrollment_id,lesson_id),
 FOREIGN KEY (enrollment_id,user_id,exam_version_id) REFERENCES app.enrollments(id,user_id,exam_version_id),
 FOREIGN KEY (lesson_id,exam_version_id) REFERENCES app.lessons(id,exam_version_id),
 CHECK (state NOT IN ('completed','placed_out') OR completed_at IS NOT NULL)
);
CREATE TABLE app.practice_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 enrollment_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 lesson_id uuid,
 mode text NOT NULL CHECK (mode IN ('lesson','quick','weakest','missed','timed','custom','mock','review','checkpoint')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired','abandoned')),
 question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 200),
 client_session_id uuid NOT NULL,
 selection_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(selection_config)='object'),
 started_at timestamptz NOT NULL DEFAULT now(),
 deadline_at timestamptz,
 completed_at timestamptz,
 FOREIGN KEY (enrollment_id,user_id,exam_version_id) REFERENCES app.enrollments(id,user_id,exam_version_id),
 FOREIGN KEY (lesson_id,exam_version_id) REFERENCES app.lessons(id,exam_version_id),
 UNIQUE (user_id,client_session_id),
 UNIQUE (id,user_id),
 UNIQUE (id,user_id,exam_version_id),
 CHECK (mode <> 'lesson' OR lesson_id IS NOT NULL),
 CHECK (deadline_at IS NULL OR deadline_at > started_at),
 CHECK (completed_at IS NULL OR completed_at >= started_at),
 CHECK (status NOT IN ('completed','expired') OR completed_at IS NOT NULL)
);
CREATE TABLE app.session_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL,
 user_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 question_version_id uuid NOT NULL,
 position integer NOT NULL CHECK (position > 0),
 presented_at timestamptz,
 FOREIGN KEY (session_id,user_id,exam_version_id) REFERENCES app.practice_sessions(id,user_id,exam_version_id),
 FOREIGN KEY (question_version_id,exam_version_id) REFERENCES app.question_versions(id,exam_version_id),
 UNIQUE (session_id,position),
 UNIQUE (session_id,question_version_id),
 UNIQUE (id,user_id,exam_version_id,question_version_id)
);
CREATE TABLE app.attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_item_id uuid NOT NULL UNIQUE,
 user_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 question_version_id uuid NOT NULL,
 client_submission_id uuid NOT NULL,
 confidence text CHECK (confidence IN ('unsure','somewhat','confident')),
 reasoning_text text,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 graded_at timestamptz,
 is_correct boolean,
 first_seen_family boolean NOT NULL DEFAULT false,
 FOREIGN KEY (session_item_id,user_id,exam_version_id,question_version_id)
   REFERENCES app.session_items(id,user_id,exam_version_id,question_version_id),
 UNIQUE (user_id,client_submission_id),
 UNIQUE (id,question_version_id),
 UNIQUE (id,user_id),
 CHECK ((graded_at IS NULL AND is_correct IS NULL) OR
        (graded_at IS NOT NULL AND is_correct IS NOT NULL))
);
CREATE TABLE app.attempt_choices (
 attempt_id uuid NOT NULL,
 question_version_id uuid NOT NULL,
 option_key text NOT NULL,
 PRIMARY KEY (attempt_id,option_key),
 FOREIGN KEY (attempt_id,question_version_id) REFERENCES app.attempts(id,question_version_id),
 FOREIGN KEY (question_version_id,option_key) REFERENCES app.question_options(question_version_id,option_key)
);
CREATE TABLE app.question_exposures (
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 family_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 answered_count integer NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
 FOREIGN KEY (family_id,exam_version_id) REFERENCES app.question_families(id,exam_version_id),
 PRIMARY KEY (user_id,family_id),
 CHECK (last_seen_at >= first_seen_at)
);
CREATE TABLE app.objective_progress (
 enrollment_id uuid NOT NULL,
 user_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 objective_id uuid NOT NULL,
 first_seen_total integer NOT NULL DEFAULT 0 CHECK (first_seen_total >= 0),
 first_seen_correct integer NOT NULL DEFAULT 0 CHECK (first_seen_correct >= 0),
 total_attempts integer NOT NULL DEFAULT 0 CHECK (total_attempts >= 0),
 last_practiced_at timestamptz,
 PRIMARY KEY (enrollment_id,objective_id),
 FOREIGN KEY (enrollment_id,user_id,exam_version_id) REFERENCES app.enrollments(id,user_id,exam_version_id),
 FOREIGN KEY (objective_id,exam_version_id) REFERENCES app.objectives(id,exam_version_id),
 CHECK (first_seen_correct <= first_seen_total),
 CHECK (first_seen_total <= total_attempts)
);
CREATE TABLE app.review_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL,
 user_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 objective_id uuid NOT NULL,
 source_attempt_id uuid,
 reason text NOT NULL CHECK (reason IN ('missed','spacing','checkpoint')),
 stage integer NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 4),
 due_at timestamptz NOT NULL,
 last_reviewed_at timestamptz,
 FOREIGN KEY (enrollment_id,user_id,exam_version_id) REFERENCES app.enrollments(id,user_id,exam_version_id),
 FOREIGN KEY (objective_id,exam_version_id) REFERENCES app.objectives(id,exam_version_id),
 FOREIGN KEY (source_attempt_id,user_id) REFERENCES app.attempts(id,user_id),
 UNIQUE (enrollment_id,objective_id)
);
CREATE TABLE app.daily_study_days (
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 study_date date NOT NULL,
 timezone_snapshot text NOT NULL,
 qualifying_session_id uuid NOT NULL UNIQUE,
 earned_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,study_date),
 FOREIGN KEY (qualifying_session_id,user_id) REFERENCES app.practice_sessions(id,user_id)
);
CREATE TABLE app.streak_state (
 user_id uuid PRIMARY KEY REFERENCES app.user_profiles(id),
 current_days integer NOT NULL DEFAULT 0 CHECK (current_days >= 0),
 longest_days integer NOT NULL DEFAULT 0 CHECK (longest_days >= 0),
 last_study_date date,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (longest_days >= current_days)
);
CREATE TABLE app.reward_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 reward_type text NOT NULL DEFAULT 'xp' CHECK (reward_type='xp'),
 amount integer NOT NULL CHECK (amount > 0),
 reason_code text NOT NULL CHECK (reason_code IN ('new_attempt','first_correct','lesson_complete','review_repeat','manual_adjustment')),
 source_type text NOT NULL CHECK (source_type IN ('attempt','session','manual')),
 source_id uuid NOT NULL,
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id,idempotency_key),
 UNIQUE (user_id,source_type,source_id,reason_code)
);
-- Optional phase-2 inventory. It must be debited in the same transaction as applying a freeze.
CREATE TABLE app.streak_freeze_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 delta integer NOT NULL CHECK (delta IN (-1,1)),
 reason text NOT NULL CHECK (reason IN ('earned','used','manual')),
 protected_date date,
 idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id,idempotency_key),
 UNIQUE (user_id,protected_date),
 CHECK ((reason='used' AND delta=-1 AND protected_date IS NOT NULL) OR
        (reason<>'used' AND delta=1 AND protected_date IS NULL))
);
CREATE TABLE app.entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 feature_key text NOT NULL CHECK (feature_key IN ('full_bank','custom_quiz','mocks','ai_explain')),
 source text NOT NULL CHECK (source IN ('preview','store','manual')),
 source_ref text NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id,feature_key,source,source_ref),
 CHECK (ends_at > starts_at)
);
CREATE TABLE private.store_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL CHECK (provider IN ('apple','google','manual')),
 provider_event_id text NOT NULL,
 user_id uuid REFERENCES app.user_profiles(id),
 event_type text NOT NULL,
 verified_at timestamptz NOT NULL,
 redacted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE (provider,provider_event_id)
);
CREATE TABLE app.notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES app.user_profiles(id),
 reminders_enabled boolean NOT NULL DEFAULT false,
 daily_local_time time NOT NULL DEFAULT '21:00',
 quiet_start time NOT NULL DEFAULT '23:00',
 quiet_end time NOT NULL DEFAULT '08:00',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.notification_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 kind text NOT NULL CHECK (kind IN ('daily_goal','streak_at_risk','circle_summary')),
 study_date date NOT NULL,
 scheduled_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','cancelled','sent','failed')),
 dedupe_key text NOT NULL UNIQUE,
 provider_message_id text,
 sent_at timestamptz
);
CREATE TABLE app.study_circles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES app.user_profiles(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
 timezone text NOT NULL DEFAULT 'Etc/UTC',
 weekly_target_days integer NOT NULL DEFAULT 5 CHECK (weekly_target_days BETWEEN 1 AND 7),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.circle_members (
 circle_id uuid NOT NULL REFERENCES app.study_circles(id),
 user_id uuid NOT NULL REFERENCES app.user_profiles(id),
 role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','removed')),
 joined_at timestamptz NOT NULL DEFAULT now(),
 left_at timestamptz,
 PRIMARY KEY (circle_id,user_id),
 CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE TABLE app.circle_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 circle_id uuid NOT NULL,
 inviter_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
 max_uses integer NOT NULL DEFAULT 10 CHECK (max_uses BETWEEN 1 AND 30),
 FOREIGN KEY (circle_id,inviter_id) REFERENCES app.circle_members(circle_id,user_id),
 CHECK (use_count <= max_uses)
);
CREATE TABLE app.circle_weeks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 circle_id uuid NOT NULL REFERENCES app.study_circles(id),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 timezone_snapshot text NOT NULL,
 target_days integer NOT NULL CHECK (target_days BETWEEN 1 AND 7),
 UNIQUE (circle_id,starts_at),
 CHECK (ends_at > starts_at)
);
CREATE TABLE app.exam_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 enrollment_id uuid NOT NULL,
 user_id uuid NOT NULL,
 exam_version_id uuid NOT NULL,
 result text NOT NULL CHECK (result IN ('passed','failed')),
 taken_at timestamptz NOT NULL,
 verification_status text NOT NULL DEFAULT 'self_reported'
   CHECK (verification_status IN ('self_reported','evidence_received','verified')),
 private_evidence_ref text,
 verified_by uuid REFERENCES app.user_profiles(id),
 verified_at timestamptz,
 FOREIGN KEY (enrollment_id,user_id,exam_version_id) REFERENCES app.enrollments(id,user_id,exam_version_id),
 CHECK (verification_status<>'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE TABLE app.analytics_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES app.user_profiles(id),
 anonymous_id uuid,
 event_name text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 source_version text NOT NULL,
 properties jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(properties)='object'),
 CHECK (user_id IS NOT NULL OR anonymous_id IS NOT NULL)
);
CREATE TABLE private.content_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES app.user_profiles(id),
 question_version_id uuid NOT NULL REFERENCES app.question_versions(id),
 action text NOT NULL CHECK (action IN ('created','reviewed','published','retired')),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 note text
);

CREATE INDEX enrollment_user_status ON app.enrollments(user_id,status);
CREATE INDEX published_questions ON app.question_versions(exam_version_id,family_id) WHERE status='published';
CREATE INDEX session_user_status ON app.practice_sessions(user_id,status,started_at DESC);
CREATE INDEX attempts_user_time ON app.attempts(user_id,submitted_at DESC);
CREATE INDEX items_session_order ON app.session_items(session_id,position);
CREATE INDEX due_review_owner ON app.review_queue(user_id,due_at);
CREATE INDEX objective_owner ON app.objective_progress(user_id,enrollment_id);
CREATE INDEX xp_owner_time ON app.reward_ledger(user_id,created_at DESC);
CREATE INDEX entitlement_lookup ON app.entitlements(user_id,feature_key,ends_at) WHERE revoked_at IS NULL;
CREATE INDEX notification_dispatch ON app.notification_jobs(scheduled_at) WHERE status='queued';
CREATE INDEX circle_member_user ON app.circle_members(user_id,status);
CREATE INDEX event_name_time ON app.analytics_events(event_name,occurred_at);
CREATE INDEX outcomes_owner ON app.exam_outcomes(user_id,taken_at DESC);
CREATE VIEW app.xp_totals AS
 SELECT user_id,COALESCE(sum(amount),0)::bigint AS xp
 FROM app.reward_ledger GROUP BY user_id;
CREATE VIEW app.published_question_prompts AS
 SELECT q.id,q.exam_version_id,q.family_id,q.prompt_markdown,q.answer_type,q.source_url,
   jsonb_agg(jsonb_build_object('key',o.option_key,'text',o.body) ORDER BY o.sort_order) AS options
 FROM app.question_versions q
 JOIN app.question_options o ON o.question_version_id=q.id
 WHERE q.status='published'
 GROUP BY q.id,q.exam_version_id,q.family_id,q.prompt_markdown,q.answer_type,q.source_url;
-- No grants to mobile/anonymous database roles are made.
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
COMMIT;

