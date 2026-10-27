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
| PATCH | `/me/preferences` | user | `timezone` (IANA; applies from next local midnight once any study is credited, once per day), `daily_goal_minutes` 5/10/15, `reminders_enabled`, `daily_local_time`, `quiet_start`, `quiet_end`, `weekly_circle_summary`, `smart_timing` (remind half an hour before the learner usually studies, once there are three recent sessions; default on), `streak_saver` (a last-call reminder at 22:00, or an hour before quiet hours, when a streak is at stake; default on), `display_name` |
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
| GET | `/enrollments/:id/score` | owner | CertPath Score (0–100) with `band`, `delta_7d`, 30-day `history`, per-domain scores, `strongest`, `focus`, `method` and `note`. Each objective is first-try accuracy on new questions, smoothed while evidence is thin ((correct + 1) / (total + 2)), times coverage that reaches full weight at five questions; domains are weighted like the blueprint. Practice evidence, not a pass prediction |
| GET | `/enrollments/:id/stories` | owner | Published stories with `question_count`, `completed` and `active_session_id` |
| GET | `/enrollments/:id/practice` | owner | Due review count, missed count, mock inventory (`full_form_available`, sample size), features, active sessions |
| GET | `/enrollments/:id/reviews` | owner | Due and upcoming concepts with stage and due time |
| GET | `/enrollments/:id/qotd` | owner | The Question of the Day for the learner's local date: `question {prompt, answer_type, objective_title, domain_title}`, `status` (`new`, `in_progress`, `done`), `session_id`, `result {correct, peer}` once answered, the QotD `streak {current, longest, answered_today}` and `gems`. Every learner on the same date gets the same question (exam formats only), picked once per exam version and date and not repeated within 60 days |
| GET | `/enrollments/:id/flags` | owner | Flagged questions, newest first, with `last_correct` and `available` (false while the family has no published revision), plus `quiz_available` |
| GET | `/enrollments/:id/level-up` | owner | Level Up per exam domain: `level_passed` (0–4), `current_level`, `label` (Foundations, Applied, Advanced, Mastery), `mastered`, `best` per level, `attempts`, question counts `by_difficulty`, and `available`/`locked` (on the free plan with Plus on, a domain opens once the path reaches it) |
| GET | `/enrollments/:id/progress` | owner | Coverage, first-seen and repeat accuracy with denominators, per-domain evidence (`enough_practice` once 5 new questions), focus recommendation, mock history. No pass probability |

## Sessions

| Method | Path | Notes |
|---|---|---|
| POST | `/sessions` | `{enrollment_id, client_session_id, mode, lesson_id?, story_id?, domain_ids?, question_count?, source_session_id?}`. Modes: `lesson`, `checkpoint`, `quick`, `missed`, `weakest`, `review`, `story`, `qotd`, `flagged`, `levelup` (free); `timed`, `custom`, full `mock` (Plus). `qotd` is today's one shared question; reopening it resumes, and once it is answered it's a 409 `qotd_done`. `flagged` draws up to 10 (max 20) of your flagged questions; 409 `nothing_flagged`. `levelup` takes exactly one `domain_ids` entry and serves 5 questions at your current level: levels 1–3 draw that difficulty first and fill from the nearest one, level 4 puts your current misses first, then the hardest questions. `missed` with `source_session_id` retries only that session's misses. Mocks and timed quizzes use only `single` and `multiple` questions, like the real exam. Story questions are served only by their story. Reopening an unfinished story returns the same session. A sample mock (≤10, one a day on the free plan) is blueprint-balanced and labelled. A full mock with thin inventory gets a 409 `insufficient_inventory` with the per-domain shortfall. Reopening an unfinished lesson returns the same session |
| GET | `/sessions` | Active sessions to resume |
| GET | `/sessions/:id` | Prompts (no keys), submissions, feedback for answered learning items, `deadline_at` and `server_time`. Items carry `family_id`, `answer_type`, `options`, `match_targets`, `presentation` (`text` or `listen`), `input_hint` and `flagged`; a submission with feedback adds `peer`. The session adds `tutor` (`any_time`, or `after_answer` for mocks and timed quizzes), `level_up {domain_id, level, label, pass_needed}` and `qotd_date`. Story sessions add `story {title, characters, parts}`, where parts are lines (`speaker`, `text`) and questions (`session_item_id`). An overdue session is finalized as `expired` first |
| POST | `/sessions/:id/answers` | `{session_item_id, client_submission_id, selected_options, typed_answer?, input_mode?, confidence?, reasoning_text?}` → `{attempt_id, accepted, feedback, peer, xp_granted}`. `peer {correct_percent, answered}` is first-try accuracy across all learners for the question family (each learner's first graded answer, invalidated revisions excluded); `correct_percent` stays `null` until five learners have answered. `selected_options` holds choices for `single`/`multiple`, every option key in sequence for `order`, `"A=2"` pairs covering every item for `match`, and is empty for `type`, which sends `typed_answer` (graded ignoring case, spacing and punctuation, with one typo allowed from five letters and two from twelve). `input_mode` is `tap`, `keyboard` or `voice`. Feedback adds `expected_answer` for typed questions; for order questions `correct_options` is the correct sequence. Mock feedback is `null` until finalized |
| POST | `/sessions/:id/complete` | Finalizes once and returns the same summary on every retry: correct/total, answered, XP, study-day credit, streak, domain breakdown, `practice_score_note`. Level Up adds `level_up {domain_id, domain_title, level, label, passed, newly_passed, correct, total, needed, next_level, mastered}`: 4 of 5 (80%, rounded up) passes and unlocks the next level once, with 10 gems and a `levelup_passed` celebration. The Question of the Day adds `qotd {date, correct, streak, longest}`; answering counts for its own streak, right or wrong, with 5 gems, but one question is not a study day |
| GET | `/sessions/:id/next` | For a finished session: a `primary` suggested next step and a `secondary` one, each `{kind, title, body, cta, start}` where `start` is the `POST /sessions` body to use (null for a break). Worked out live in this order: a long day (40 minutes or 5 sessions) leads with `take_break`; then the Level Up follow-up, `retry_missed` (2+ misses), `review_due`, `qotd`, `next_lesson`, `flagged` (3+), `retry_missed` (1 miss) and `weakest` |
| POST | `/sessions/:id/abandon` | Non-mock sessions only; earns nothing |
| GET | `/sessions/:id/results` | The stored completion summary |
| GET | `/sessions/:id/feedback` | Reviewed feedback for every item, after finalization for mocks |

## Help, outcomes, social and events

| Method | Path | Notes |
|---|---|---|
| POST | `/explanations` | `{attempt_id, style: short\|analogy\|comparison}` (Plus). `origin` is `generated` or `reviewed_fallback`; failures, refusals, timeouts and exhausted budgets fall back to the reviewed rationale |
| GET | `/tutor/:sessionItemId` | The tutor conversation for a question in one of your sessions: `phase` (`before` or `after` the answer), `available`, `mode` (`ai`, or `hints` without an API key), `intro`, quick `suggestions`, `remaining` messages and `messages [{role, text, phase, origin, at}]` |
| POST | `/tutor/:sessionItemId` | `{message, client_message_id}` (AI help; 12 learner messages per question; shares the explanation budget and rate limit). Before the answer the tutor guides without revealing it: the server checks each reply for the correct letter, the correct option singled out or quoted, the typed answer, a full correct order or a correct match pair, rewrites once with a stricter prompt, then falls back to a reviewed hint. After the answer it discusses freely, grounded in the reviewed explanation. Without AI it walks a reviewed hint ladder (topic and strategy, one ruled-out option, the documentation) and gives the reviewed explanation after the answer. 409 `tutor_locked` before the answer in mocks and timed quizzes, `tutor_limit` at the cap. A retried `client_message_id` returns the stored conversation |
| PUT | `/flags/:familyId` | `{question_version_id}` of a question you were shown. Flags follow the family, so a revised question stays flagged. Idempotent |
| DELETE | `/flags/:familyId` | Unflags; idempotent |
| POST | `/exam-outcomes` | `{enrollment_id, result: passed\|failed, taken_at, pause_reminders, client_request_id}` → self-reported outcome. Use `PATCH /enrollments/:id` to postpone |
| POST | `/issue-reports` | `{question_version_id, attempt_id?, reason, note?}` for a question you were shown |
| GET / POST | `/circles` | List yours, or create `{name, timezone, weekly_target_days}` (account) |
| GET | `/circles/:id` | Active members only; weekly study days in the circle's snapshotted timezone, max 7 |
| POST | `/circles/:id/invites` | → `{invite_url, expires_at}` (7 days, 10 uses; only the token hash is stored) |
| POST | `/circles/:id/leave` | The owner must be the last member (the circle is then archived) |
| POST | `/circle-joins` | `{token}` |
| POST | `/events` | Client analytics: allowlisted event names and properties only |

## Engagement (gems, quests, streaks, leagues, friends)

Everything is decided and stored by the server; the app only displays it. Numbers live in `api/src/lib/rules.ts`. Gems are earned only (lessons, chests, badges, the monthly challenge, league podiums, circle quests); CertPath sells nothing for money.

`POST /sessions/:id/complete` (and `GET /sessions/:id/results`) include `engagement`: `accuracy`, `duration_seconds`, `gems_earned`, `gems_total`, `level {level, title, xp, floor, next, leveled_up}`, `quests [{key, label, target, progress, done}]`, `chest_available`, `league {tier, rank, previous_rank, size, xp, promote, demote, ends_at} | null` and `celebrations`. A retried completion returns the same stored summary.

| Method | Path | Notes |
|---|---|---|
| GET | `/me/recap` | `?period=month&value=YYYY-MM` or `?period=year&value=YYYY` (defaults: this month, or last month during the first week). Study days, longest run, questions, accuracy, XP, gems, minutes, lessons, stories, mocks, best day, top domain, a learner type (night owl, early bird, lunch-break learner, weekend warrior, steady builder, explorer), badges, best league finish, high-fives, the score's start and end, and `share_text` |
| GET | `/me/engagement` | Gems, freezes (max 2), weekend amulet, wager, XP boost, repair offer, level, league tier, shop prices. Applies freezes or the amulet to missed days first |
| GET | `/me/quests` | Today's three quests (sized to the daily goal), the chest, and the monthly challenge (30 quests) |
| POST | `/me/quests/chest` | Opens today's chest once all three quests are done: gems, a 15-minute double-XP boost, or a streak freeze. Repeats return the same reward. 409 `quests_incomplete` |
| GET | `/me/achievements` | Badge catalog with `earned_at`, plus earned monthly-challenge badges |
| GET | `/me/celebrations` | Queued moments to play, oldest first: `level_up`, `achievement`, `streak_milestone`, `quest_complete`, `quests_done`, `monthly_challenge`, `freeze_used`, `amulet_used`, `streak_broken`, `streak_repaired`, `wager_won`, `wager_lost`, `league_result`, `friend_streak`, `high_five`, `nudge`, `circle_quest`, `levelup_passed` |
| POST | `/me/celebrations/seen` | `{ids}`: marks them played |
| GET / POST | `/shop`, `/shop/purchase` | `{item: streak_freeze \| weekend_amulet \| streak_repair \| streak_wager, client_request_id}`. Idempotent per request ID. 409 `not_enough_gems`, `freezes_full`, `amulet_active`, `nothing_to_repair`, `wager_active` |
| GET | `/leagues/current` | This week's table (UTC Monday to Monday, up to 30 learners per cohort, six tiers from Bronze to Lakehouse) with promotion and demotion zones, or `joined: false` until the first XP of the week |
| PUT | `/me/league-visibility` | `{hidden}`: leave and stay out of league tables |
| GET / POST | `/friend-streaks` | `{friend_id}` of someone in one of your circles; up to 5. A day counts when both studied that date |
| POST | `/friend-streaks/:id/accept\|decline\|end` | Only the invited friend can accept |
| POST | `/friends/:id/high-five`, `/friends/:id/nudge` | Circle members only; one of each per friend per day. A nudge is refused once they've studied (409 `already_studied`) |
| GET | `/circles/:id/activity` | The weekly circle quest (XP together, 100 per member, max 1,500), members' weekly XP and whether each studied today (so nudges go only to those who haven't), and recent finished lessons |

Streak rules: a freeze, the weekend amulet or a repair protects a missed date, which keeps the streak continuous but never counts as a study day. Freezes are spent only when every missed day can be covered; otherwise the streak breaks, the freezes are kept, and a repair is offered for 3 days. A wager stakes 50 gems on keeping the streak for 7 days and pays 100.

## Backoffice (staff)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | Seven-day metrics with denominators and event counts |
| GET | `/admin/reminders` | Each reminder template with an example, sends, study days within six hours of a send, and the rate. The reminder bandit picks wording per learner from these (see below) |
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
| GET / POST | `/admin/questions` | List (filters `exam_version_id`, `status`, `objective_id`, `needs_review`, `q`) or create a family with draft revision 1. `answer_type` is `single`, `multiple`, `order` (options in their correct order, `correct_options` in that order), `match` (aligned `options` and `match_targets`, `correct_options` as `"A=1"` pairs) or `type` (`accepted_answers`, optional `input_hint`). Order and match keys are scrambled on save so they never reveal the answer. `presentation: listen` reads the prompt aloud |
| GET / POST | `/admin/stories` | List a version's stories, or create one: `{exam_version_id, slug, title, summary?, characters [{name, role}], parts [{kind: line, speaker?, text} \| {kind: question, family_key}], status}`. Saving tags the questions with the story so regular practice skips them; publishing needs every question published |
| GET / PUT | `/admin/stories/:id` | Read or replace a story |
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

## Reminder wording

Each push reminder's words are chosen per learner when it is sent, by a Thompson-sampling bandit over the templates in `api/src/services/reminders.ts`:

- Only templates whose facts are true right now compete. For example, "Keep your 6-day streak alive" needs a streak, "Sam studied today" needs a friend streak partner who studied, and "So close: get 8 answers right" needs a quest that's partly done.
- Every template's results across all learners form a Beta prior, capped at 20 pseudo-sends. The learner's own sends and study days update it, and one draw per template picks the winner.
- A template sent to the learner in the last day scores near zero, recovering to half after a day and three quarters after two, so wording doesn't repeat.
- A send converts when the learner earns a study day within six hours.
- The evening streak saver only uses urgent templates: streak, milestone, wager, demotion zone and friend waiting.
- Friends' nudges are pushed immediately, at most once a day per learner, outside quiet hours and only to learners who turned reminders on.
