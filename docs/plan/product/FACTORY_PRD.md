# Product requirements: CertPath v2
Status: implementation-ready design draft; commercially unvalidated. No native client, hosted API or production bank is delivered.

## Scope and ownership
Proposed native client: Expo / React Native with TypeScript, for iOS and Android. Proposed backend: authenticated API, PostgreSQL, a scheduled notification worker, and a private content-review interface. Pin supported toolchain versions when implementation starts. This package does not select a hosting vendor or create infrastructure.

The mobile client owns presentation, selected options before submission and a retry queue. The server owns grading, question selection, deadlines, reward eligibility, study dates, streaks, entitlements and analytics used for business metrics. Store secrets and answer keys remain on the server.

Guest exploration is allowed. Production account creation occurs before synchronizing durable progress or starting a store purchase. Merge guest attempts atomically into one authenticated identity, with explicit consent and deduplication. Prototype local storage is not production account or security behavior.

## Core loop
1. Select supported exam and a daily goal. Date is optional.
2. Open the next lesson on the path; see its topic and expected length.
3. Answer five questions; get reviewed feedback after each answer.
4. Read a correction; optionally ask for a simpler explanation.
5. Complete the session; earn activity XP and at most one study-day credit.
6. Return to due review or the next lesson. A new scenario checks a weak concept later.
7. Take blueprint-balanced mock exams when useful, then record the real outcome and graduate.

Five questions is a small lesson size, not a guarantee of five minutes. Larger scenario items may need more time.

## Content and path rules
Questions belong to exam version → domain → objective → family → immutable question revision. A family represents substantially the same tested idea; wording changes do not count as a new concept. Store original prompts, correct options, rationale, source URL, review metadata and audit history. No recalled live exam questions.

A lesson unlocks the next lesson when all assigned items are submitted and feedback is available. Completion does not mean mastery. A checkpoint uses fresh families when possible. The proposed placement threshold of 4/5 only places a learner past a small introductory lesson; it is not an exam readiness threshold.

A published exam version needs reviewed domain weights totaling 100%, a reviewed objective map and sufficient usable content. A published question needs at least two options, exactly one correct option for single-select, at least one for multi-select, a rationale, valid objective mapping and human review. These publication checks are an API transaction; schema constraints alone do not enforce all of them.

## Session modes
| Mode | Selection | Feedback |
|---|---|---|
| Daily lesson / Quick 5 | Lesson pool / five underexposed families | After each submitted answer |
| Due review | Due objectives; prefer a fresh scenario | After each answer |
| Missed | Family whose latest graded attempt is incorrect | After each answer |
| Weakest | Low first-seen accuracy with minimum sample size; otherwise coverage gaps | After each answer |
| Timed / Custom | Chosen domains, size and duration, respecting inventory | After each answer unless exam-style chosen |
| Mock | Blueprint-balanced reserved form; fixed deadline | Only after submit or expiry |

Show the denominator for every accuracy measure. “Not enough practice yet” is better than ranking a domain after one item. Retire or replace a bad question and recompute affected aggregates through an auditable repair job.

Mock allocation: for a 45-item form and weights 6/21/22/16/10/10/15, largest-remainder allocation produces 3/9/10/7/4/5/7 with ties resolved in favor of the later domain in guide order. Preserve the selected revision in the session. A form with unavailable inventory must fail cleanly or explicitly offer a smaller practice sample, rather than silently calling it a full mock.

## Functional acceptance criteria
| ID | Requirement | Acceptance |
|---|---|---|
| F01 | Exam onboarding | Only published/pilot-supported banks enroll; AWS/Fabric planned paths cannot start |
| F02 | Persistent path | Reopen the app and resume the same unfinished lesson and assigned revisions |
| F03 | Graded answer | Server validates ownership and option membership; one final answer per item |
| F04 | Retry-safe completion | Retrying answer/completion returns the original result and creates no duplicate XP or study credit |
| F05 | Explanations | Every graded learning item returns a reviewed rationale and source; AI failure falls back to it |
| F06 | Spaced review | Missed objectives appear due tomorrow in learner timezone; successful review advances the proposed schedule |
| F07 | Healthy streak | One credited local study date per learner; timezone changes do not rewrite history |
| F08 | Practice progress | Coverage, new-family accuracy, repeated-item accuracy, XP and mock scores remain distinct |
| F09 | Timed mock | Server deadline keeps running in background; timeout grades unanswered items incorrect and finalizes once |
| F10 | Free access | Corrections and due review remain accessible after Plus expiry |
| F11 | Store entitlement | Grant only from verified store event; duplicates do not extend twice; restore supported |
| F12 | Graduation | Outcome can pause enrollment/reminders; “passed” remains self-reported unless verified |
| F13 | Optional social | Declining or leaving a circle does not block learning; no contacts upload |

## Nonfunctional boundaries
Authenticate every private API request. Authorize by token subject, never request user_id. Validate IANA timezones, allowed enum values and content size. Encrypt traffic and storage through chosen platform controls; log metadata without answer text, evidence uploads, email addresses or raw voice. Apply rate limits to attempt, AI and invite endpoints.

Use 44pt minimum native touch targets, screen-reader labels, text scaling, visible focus and reduced motion. Never rely on red/green alone. The prototype includes labels and keyboard buttons but is not an accessibility conformance audit.

Start with online-first graded sessions. Previously fetched explanations can be readable offline. A network failure preserves the pending submission; the server response decides whether it already committed. Do not grant official XP or exam-style results from client-computed grades. Full offline grading is deferred.

## Phase boundaries
Pilot: daily path, core practice, reviewed explanations, review queue, basic mock, progress, guest-to-account migration and server reward logic. Paid beta: real entitlements, receipt validation, restoration, preview lifecycle and operational support. Phase 2: private circles and optional voice explanations. Launch AWS/Fabric only after each bank has a reviewed current blueprint and adequate content.

The Friends screen and its database tables illustrate phase 2. They are not a requirement to ship the first paid pilot.

