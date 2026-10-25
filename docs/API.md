# CertPath API reference (v1)

Base path `/v1`. JSON in and out, snake_case fields. The design contract is `docs/plan/api/openapi.json`. This file documents what the server implements, including additions to that contract.

**Auth.** Send `Authorization: Bearer <token>` from `/auth/*`. Identity always comes from the token subject. "Staff" means the `reviewer` or `admin` role; "admin" means `admin` only.

**Errors.** Every error is `{ code, message, request_id, details? }`. Common codes:

| Status | Code | Meaning |
|---|---|---|
| 400 | `validation_failed` | Body or query is invalid; unknown fields are rejected. `details.issues` lists them |
| 401 | `unauthorized` | Missing, expired or revoked token |
| 403 | `plus_required` | Needs Plus; `details.feature` is `full_bank`, `custom_quiz`, `mocks` or `ai_explain`. Never returned while Plus is off (`PLUS_ENABLED=false`, the default), when every learner has every feature |
| 403 | `account_required`, `insufficient_role` | Guest or role restriction |
| 404 | `not_found` | Missing, malformed or not yours |
| 409 | `idempotency_conflict` | A request ID was reused with a different body |
| 409 | `already_answered`, `session_expired`, `items_unanswered`, `insufficient_inventory`, `nothing_due`, `nothing_missed`, `preview_already_used`, … | State conflicts with a readable message |
| 429 | `rate_limited`, `timezone_change_limited` | Slow down |

## Accounts

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/guest` | — | `{timezone, display_name?, anonymous_id?}` → `{token, user}`. Guests get a real identity for server-side grading |
| POST | `/auth/register` | optional | `{email, password ≥8, display_name?, timezone?}`. With a guest token this upgrades the same identity (`upgraded_guest: true`) |
| POST | `/auth/login` | — | `{email, password}` → `{token, user}` |
| POST | `/auth/logout-all` | user | Revokes every token for the user |
| GET | `/me` | user | Profile, streak (current, longest, this week's credited days), XP, `plus_enabled`, active entitlements, preview used, preferences, enrollments |
| PATCH | `/me/preferences` | user | `timezone` (IANA; applies from next local midnight once any study is credited, once per day), `daily_goal_minutes` 5/10/15, `reminders_enabled`, `daily_local_time`, `quiet_start`, `quiet_end`, `weekly_circle_summary`, `display_name` |
| GET | `/me/entitlements` | user | Active entitlements |
| POST | `/me/preview` | account | `{accept_terms: true, client_request_id}`. One no-card, nonrenewing 14-day preview per account. 409 `plus_unavailable` while Plus is off |
| POST / DELETE | `/me/push-tokens` | user | Register or remove an Expo push token |
| POST | `/me/deletion-request` | user | Stops reminders, leaves circles and signs out everywhere; data is deleted after `DELETION_GRACE_DAYS` |
| POST | `/store/verify` | account | `{provider, signed_transaction, client_request_id}`. Only the sandbox verifier exists (`sandbox:<product>:<txn>`); Apple and Google return 501. Duplicate events never extend access; another account's receipt gets a 409. 409 `plus_unavailable` while Plus is off |

## Catalog and learning path

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/exams` | — | Catalog with `enrollable` and `current_version` (question count, duration, guide) |
| GET / POST | `/enrollments` | user | POST `{exam_version_id, exam_date?, client_request_id}`; planned exams get a 409 `exam_not_available` |
| PATCH | `/enrollments/:id` | owner | `{exam_date?, status?: active\|paused}`. Pausing cancels queued reminders |
| GET | `/enrollments/:id/path` | owner | Ordered lessons with `locked/available/in_progress/completed`, units, `current_lesson_id` and `active_session_id` |
| GET | `/enrollments/:id/practice` | owner | Due review count, missed count, mock inventory (`full_form_available`, sample size), features, active sessions |
| GET | `/enrollments/:id/reviews` | owner | Due and upcoming concepts with stage and due time |
| GET | `/enrollments/:id/progress` | owner | Coverage, first-seen and repeat accuracy with denominators, per-domain evidence (`enough_practice` once 5 new questions), focus recommendation, mock history. No pass probability |

## Sessions

| Method | Path | Notes |
|---|---|---|
| POST | `/sessions` | `{enrollment_id, client_session_id, mode, lesson_id?, domain_ids?, question_count?}`. Modes: `lesson`, `checkpoint`, `quick`, `missed`, `weakest`, `review` (free); `timed`, `custom`, full `mock` (Plus). A sample mock (≤10, one a day on the free plan) is blueprint-balanced and labelled. A full mock with thin inventory gets a 409 `insufficient_inventory` with the per-domain shortfall. Reopening an unfinished lesson returns the same session |
| GET | `/sessions` | Active sessions to resume |
| GET | `/sessions/:id` | Prompts (no keys), submissions, feedback for answered learning items, `deadline_at` and `server_time`. An overdue session is finalized as `expired` first |
| POST | `/sessions/:id/answers` | `{session_item_id, client_submission_id, selected_options, confidence?, reasoning_text?}` → `{attempt_id, accepted, feedback, xp_granted}`. Mock feedback is `null` until finalized |
| POST | `/sessions/:id/complete` | Finalizes once and returns the same summary on every retry: correct/total, answered, XP, study-day credit, streak, domain breakdown, `practice_score_note` |
| POST | `/sessions/:id/abandon` | Non-mock sessions only; earns nothing |
| GET | `/sessions/:id/results` | The stored completion summary |
| GET | `/sessions/:id/feedback` | Reviewed feedback for every item, after finalization for mocks |

## Help, outcomes, social and events

| Method | Path | Notes |
|---|---|---|
| POST | `/explanations` | `{attempt_id, style: short\|analogy\|comparison}` (Plus). `origin` is `generated` or `reviewed_fallback`; failures, refusals, timeouts and exhausted budgets fall back to the reviewed rationale |
| POST | `/exam-outcomes` | `{enrollment_id, result: passed\|failed, taken_at, pause_reminders, client_request_id}` → self-reported outcome. Use `PATCH /enrollments/:id` to postpone |
| POST | `/issue-reports` | `{question_version_id, attempt_id?, reason, note?}` for a question you were shown |
| GET / POST | `/circles` | List yours, or create `{name, timezone, weekly_target_days}` (account) |
| GET | `/circles/:id` | Active members only; weekly study days in the circle's snapshotted timezone, max 7 |
| POST | `/circles/:id/invites` | → `{invite_url, expires_at}` (7 days, 10 uses; only the token hash is stored) |
| POST | `/circles/:id/leave` | The owner must be the last member (the circle is then archived) |
| POST | `/circle-joins` | `{token}` |
| POST | `/events` | Client analytics: allowlisted event names and properties only |

## Backoffice (staff)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | Seven-day metrics with denominators and event counts |
| GET | `/admin/exams` | Exams with versions |
| PATCH | `/admin/exams/:id` | Admin. Status, title, subtitle |
| POST | `/admin/exams/:id/versions` | Admin. New draft blueprint |
| GET / PATCH | `/admin/exam-versions/:id` | Detail with domains, objectives (published/draft counts), units, lessons and readiness. PATCH is admin, draft only |
| POST | `/admin/exam-versions/:id/publish` | Admin. Blocked until weights total 100, every domain has objectives, and every published lesson has published questions |
| POST / DELETE | `/admin/exam-versions/:id/domains[/:domainId]` | Admin, draft only |
| POST / DELETE | `/admin/exam-versions/:id/objectives[/:objectiveId]` | Draft only; DELETE is admin and refuses objectives in use |
| POST | `/admin/exam-versions/:id/units`, `/admin/exam-versions/:id/lessons` | Create or update (pass `id`) |
| POST | `/admin/lessons/:id/status` | `draft`, `published` or `retired` |
| GET | `/admin/exam-versions/:id/families` | Families with their latest revision, for lesson pools |
| GET / POST | `/admin/questions` | List (filters `exam_version_id`, `status`, `objective_id`, `needs_review`, `q`) or create a family with draft revision 1 |
| GET / PUT | `/admin/questions/:id` | Detail with key, rationale, revisions, audit, issues and attempt stats. PUT edits a draft and clears its review |
| POST | `/admin/questions/:id/review` | Approve a draft (`SEPARATE_REVIEWER=true` requires a different person) |
| POST | `/admin/questions/:id/publish` | Re-validates and publishes; retires the family's previous published revision |
| POST | `/admin/questions/:id/revisions` | New draft revision from edited content |
| POST | `/admin/questions/:id/retire` | `{note, invalidate_attempts}`. Invalidation excludes past attempts and recomputes affected learners' objective counters |
| GET / PATCH | `/admin/issues[/:id]` | Triage learner reports |
| GET | `/admin/learners[/:id]` | Support search and detail |
| POST | `/admin/learners/:id/entitlements`, `/admin/entitlements/:id/revoke` | Admin. Dated manual grants and revocations |
| GET / POST | `/admin/staff` | List staff; admins create reviewers or admins |
| GET / PATCH | `/admin/outcomes[/:id]` | Outcome verification (PATCH is admin) |
| GET | `/admin/audit` | Staff actions, filterable by entity |
