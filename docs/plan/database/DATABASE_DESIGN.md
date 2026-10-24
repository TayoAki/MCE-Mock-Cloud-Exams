# Database design
PostgreSQL reference schema, 38 base tables. The executable source is schema.sql; seed_demo.sql contains fictional users and five draft questions. See column_dictionary.csv for every declared column and TRANSACTIONS_AND_ACCESS.md for ownership and service boundaries.

## Table groups
| Group | Tables | Purpose |
|---|---|---|
| Identity and catalog (5) | user_profiles, exams, exam_versions, domains, objectives | Identity, pinned guide version and objective map |
| Path and bank (8) | units, lessons, lesson_objectives, question_families, question_versions, question_options, private.question_explanations, private.correct_options | Reviewed curriculum and private grading |
| Lesson selection (1) | lesson_question_pool | Allowed families per lesson |
| Learning records (10) | enrollments, lesson_progress, practice_sessions, session_items, attempts, attempt_choices, question_exposures, objective_progress, review_queue, exam_outcomes | Practice, repeat separation and outcomes |
| Habits and delivery (6) | daily_study_days, streak_state, reward_ledger, streak_freeze_ledger, notification_preferences, notification_jobs | Idempotent activity and opt-in reminders |
| Access (2) | entitlements, private.store_events | Preview and verified store access |
| Optional social (4) | study_circles, circle_members, circle_invites, circle_weeks | Private weekly study-day challenges |
| Audit and telemetry (2) | analytics_events, private.content_audit | Restricted event and audit records |

Counts total 38. Freeze and circle tables are phase 2; the first pilot can omit them.

## Relationships and constraints
A user has multiple exam-version enrollments. A version has domains, objectives and a path. Question families map to one objective; revisions are immutable snapshots. A session belongs to an enrollment/user/version and holds assigned revision IDs. Each item accepts one committed attempt with one or more selected options. Composite foreign keys prevent cross-user/cross-version record mixing.

Private answer keys reference real option rows. The published delivery view excludes correct keys and rationales. Server feedback joins private grading data only after submission or mock finalization.

Daily credits are unique by user/date. Rewards use unique idempotency and source/reason keys. Streak state and objective counters are derived aggregates; raw attempts and dated study credits remain rebuildable sources of truth.

Use UUID IDs, UTC event timestamps, local date/timezone snapshots for study days, JSONB for bounded configuration/events, and explicit joins for options, objectives and membership. Keep private evidence and billing payloads out of analytics.

## Using the reference
Run schema.sql then seed_demo.sql on an empty disposable database. PGlite execution was checked. This is not a migration framework or production deployment; do not run demo seed against customer data.

Publication completeness, cumulative freeze inventory, active membership, pending timezone changes, event-ingestion deduplication and request-body idempotency need service logic or additional migrations. The transaction guide identifies these limits. There is no RLS assertion and no mobile database role.

ERD_overview.svg is a readable relationship overview. Three ERD_*.mmd sources show focused relationships; all fields/composite constraints are authoritative in schema.sql.

