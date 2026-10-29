# CertPath API

REST API for the learner app and the content backoffice. Express 5, TypeScript, MongoDB (Mongoose 9) and Passport JWT. Endpoints are listed in [`docs/API.md`](../docs/API.md).

## Run it

```bash
npm install
npm run dev          # in-memory MongoDB replica set, seeded, on http://localhost:4000/v1
npm test             # 54 integration and rule tests against a real replica set
npm run typecheck
npm run build && npm start   # production build; needs MONGODB_URI
```

`npm run dev` needs no database: with `MONGODB_URI` unset it starts a throwaway single-node replica set and seeds it. The seed prints the staff and learner logins. To keep data between runs, use the Mongo service in the root `docker-compose.yml` and `npm run seed`.

MongoDB must run as a **replica set**, because answering and completing sessions use multi-document transactions. Settings are documented in `.env.example`; production refuses to start with the default `JWT_SECRET` and the seed script refuses to run.

## Design

- **Identity comes from the token.** `requireAuth` resolves `req.user` from the JWT subject. No endpoint accepts a `user_id`, grade, XP or streak from the client. Bumping a user's `tokenVersion` revokes all of their tokens; this happens on sign-out-everywhere and on deletion requests.
- **Private grading data.** Answer keys and rationales live in `private_question_keys` and are read only after grading (or after a mock is finalized). Responses are built by explicit serializers, never by returning a document.
- **Idempotency.** Answers are unique per `(user, client_submission_id)` and per session item. Sessions are unique per `(user, client_session_id)`, rewards per `(user, idempotency_key)`, and study days per `(user, local date)`. Other mutations that take a `client_request_id` store the response and return it on retry; a reused ID with a different body gets a 409.
- **Transactions.** `services/grading.ts` and `services/completion.ts` lock the session document at the start of each transaction, so concurrent retries serialize and complete exactly once. Tests run four duplicate submissions and three concurrent completions in parallel.
- **Rules in one place.** XP amounts, the qualifying-session size, review intervals (1/3/7/14 days), the minimum ranking sample and blueprint allocation are in `src/lib/rules.ts`, ported from the plan's `reference_rules.cjs`.
- **Timezones.** Study dates use the learner's effective IANA timezone (Luxon). Changes take effect at the next local midnight once the learner has any study credit, and historical credits never move.
- **Workers.** `src/workers` runs in-process: it expires overdue timed sessions, plans and dispatches opted-in reminders, and processes deletions after the grace period. Run one API instance with `WORKERS_ENABLED=true`, or move these to a job runner.
- **AI explanations.** `services/explain.ts` calls Claude (`AI_MODEL`, default `claude-opus-5-5`) at low effort with server-side refusal fallbacks enabled. It enforces per-user and global daily budgets and a timeout. The reviewed rationale is the source of truth and the fallback for every failure, refusal or missing key.

## From the PostgreSQL plan to MongoDB

The plan's 38-table reference schema (`docs/plan/database/schema.sql`) became 35 collections. Join tables were folded into the documents that own them, and the unique constraints were kept as indexes:

| Plan tables | Collection(s) |
|---|---|
| `user_profiles` | `users` (adds credentials, roles, guest flag, pending timezone) |
| `exams`, `exam_versions`, `domains`, `objectives`, `units` | same names |
| `lessons` + `lesson_objectives` + `lesson_question_pool` | `lessons` (`objectiveIds`, ordered `poolFamilyIds`) |
| `question_families`, `question_versions` + `question_options` | `questionfamilies`, `questionversions` (options embedded) |
| `private.correct_options` + `private.question_explanations` | `private_question_keys` |
| `practice_sessions` + `session_items` | `practicesessions` (items embedded, with the completion summary) |
| `attempts` + `attempt_choices` | `attempts` (selected options embedded) |
| `question_exposures`, `objective_progress`, `review_queue`, `lesson_progress`, `enrollments`, `exam_outcomes` | same names (review history embedded) |
| `daily_study_days`, `streak_state`, `reward_ledger`, `notification_preferences`, `notification_jobs` | same names, plus `pushtokens` |
| `entitlements`, `private.store_events` | `entitlements`, `private_store_events` |
| `study_circles`, `circle_members`, `circle_invites`, `circle_weeks` | same names |
| `analytics_events`, `private.content_audit` | `analyticsevents`, `private_content_audit` |
| — | `issuereports`, `idempotencyrecords`, `aiusages` (new) |

`streak_freeze_ledger` (phase 2, deferred by decision D10) is not implemented.

## Layout

```
src/
  app.ts, index.ts, dev.ts, config.ts, db.ts
  auth/       Passport JWT strategy, token signing, scrypt passwords, role guards
  lib/        errors, HTTP helpers, idempotency, analytics allowlist, rules, time, rate limits
  models/     Mongoose schemas
  services/   selection, sessions, grading, completion, progress, account, explain,
              circles, notifications, deletion, content-admin, admin-ops
  routes/     auth, learner, sessions, me, circles, admin
  workers/    in-process schedulers
  seed/       60-question draft bank and the idempotent seed
test/         vitest + supertest against mongodb-memory-server (replica set)
```
