# Measurement and evaluation plan
Status: proposed experiments, no collected CertPath data.

## Define metrics before optimizing
| Metric | Definition / denominator | Caveat |
|---|---|---|
| Activation | Signup/guest cohort completing first five-item lesson within 24h / new eligible cohort | Deduplicate guest merges |
| D1/D7/D30 retained study | New cohort with a qualifying study event on local day 1/7/30 / original eligible cohort | State exact-day or windowed; do not mix |
| Weekly active study | Distinct people with a qualifying session in seven days | Not opens, XP or reminder taps |
| WAU with useful review | Weekly active learners completing a due review / weekly active learners with due reviews | May reflect queue pressure |
| Objective transfer | First response on an unseen scenario after correction, stratified by objective | Randomize families; avoid answer leakage |
| Mock improvement | Paired scores on comparable fresh forms with version and baseline retained | No causal claim without a control |
| Exam outcomes | Reported passes / reported attempted exams, with verification status | Report response bias and cohort coverage |
| Preview conversion | Eligible preview starters selecting and completing verified paid purchase / eligible preview starters | Separate expiry from card-trial billing |
| Referral activation | Referred people completing a first lesson / valid unique referred people | Exclude self/referral spam |
| DAU/MAU | Daily active users / monthly active users, with activity definition | Frequency ratio; not same-day return or D7 |

Proposed north-star candidate: weekly learners who complete a lesson and demonstrate a later correction on a fresh scenario. Track it with denominators; it is a design hypothesis. Do not optimize app opens at the expense of learning.

## Event contract
Server-authoritative events: enrollment_created, session_started, answer_graded, session_completed, study_day_credited, reward_granted, review_scheduled, mock_finalized, entitlement_changed, exam_outcome_recorded.
Client events: onboarding_viewed, daily_goal_selected, explanation_opened, source_opened, reminder_prompt_viewed, paywall_viewed, circle_invite_requested.
Worker events: reminder_suppressed, reminder_sent, reminder_failed.

Every event has event_id, actor or anonymous identity, occurred_at UTC, source_version, exam_version_id where relevant, session_id where relevant and a documented property allowlist. Use server event IDs for ingestion deduplication. The reference analytics_events table is a staging store; add a unique external event_id column before implementing production ingestion. It deliberately does not pretend to solve an analytics pipeline.

Never put email, voice/audio, freeform reasoning, exam evidence, correct option text or raw AI prompts in analytics properties. Link acquisition through a pseudonymous anonymous ID; do not merge two unrelated people.

## Evaluation stages
1. Content audit: reviewers check objective mapping, source validity, current guide, ambiguity, exact key match and explanation. Require 100% published items reviewed, no unresolved critical errors, and mock-domain weights/coverage verified.
2. Usability: 8–12 relevant candidates perform onboarding, miss a question, find its correction, resume a lesson, start a mock and interpret progress. Proposed gate: at least 8/10 can complete the main loop without facilitator assistance; record confusion qualitatively.
3. Learning pilot: estimate baseline performance and delayed fresh-scenario results. Do not invent a statistically powered sample size before effect size and variance are estimated.
4. Habit experiment: compare practice-bank home versus daily-path home, randomized at user level, with both receiving equivalent content. Primary measure: week-one qualifying study days. Guardrails: transfer performance, frustration, opt-outs and refund requests.
5. Monetization test: test a concrete price/offer after useful practice. Report verified purchases and refunds, not only clicks or stated intent.

The 8/10 gate, five-question size, 14-day preview and proposed prices are starting thresholds. They are not industry benchmarks. Calculate experiment sample size from measured baseline and the minimum useful effect; do not declare success on a small favorable percentage.

## Engineering validation
Reference checks cover SQL migration/seed execution, FK isolation across user and exam versions, invalid choice rejection, unique reward/study keys, streak date behavior, and offline prototype lesson/mock routes. Native release still needs real auth, store sandboxes, push devices, timezone change scheduling, load tests, crash recovery and privacy/account deletion checks.

