# Transactions, access and correctness

## Boundary
Reference schema: PostgreSQL, app and private schemas, 38 tables. This is an API-only design. Mobile code never receives database credentials or direct query permission. PUBLIC has no access to either schema. There is no claimed row-level-security implementation in this package. Production must create a least-privilege API service role, migration role and content-review role; the API enforces end-user ownership.

private.correct_options, private.question_explanations, private.store_events and private.content_audit are server-only. Prompt delivery uses an explicit allowlist with options but no keys or rationale. Learning feedback can return rationale after grading; mock feedback waits until finalization. Do not serialize a database row directly into a client payload.

Question selection, attempt creation, reward source ownership and role verification are API responsibilities. Composite foreign keys add defense against accidentally mixing one learner’s enrollment with another learner’s session or assigning a question from another exam version.

## Answer transaction
1. Verify token subject → user_profiles and active enrollment. Lock session/item; confirm the deadline and question revision.
2. Resolve idempotency by (user_id, client_submission_id). Same ID and same body returns saved result; same ID with different body is a 409. A final answer for an item is immutable.
3. Check submitted option keys exist for the assigned revision; enforce answer cardinality and exact-set match for multi-select.
4. Insert attempt and choices, grade privately, record family exposure, update objective counters and due review. A mock retains feedback until completion.
5. Insert eligible reward rows with unique keys. Commit. Client errors after commit are resolved by retry, not regrading or adding XP.

The database rejects missing option membership and duplicate IDs but does not by itself compare the idempotent request body or prevent a privileged SQL update. Implement those policies at the API and audit boundary.

## Completion transaction
Lock the session and user streak row. Complete/expire once using server time; unanswered mock items score incorrect. Validate actual submitted work separately for study credit. Compute rewards from first exposure and first lesson completion, using explicit keys such as attempt:<uuid>:new, attempt:<uuid>:correct and enrollment:<uuid>:lesson:<uuid>:complete. The reward ledger’s source_id is intentionally polymorphic and has no generic foreign key: the API must verify ownership and allowed source type before inserting.

Insert a daily study day with ON CONFLICT DO NOTHING. Only if a new credit is inserted should current/longest streak be updated. Use server-derived local dates and a stored timezone snapshot. Cancel queued eligible reminders in the same transaction. Return a stable completion summary. A serializable retry or row-lock strategy must handle two concurrent completions.

Question count and item position bounds, “all items submitted,” publication eligibility and reward eligibility are not fully encoded as SQL constraints. Test them at the service layer. Do not claim schema.sql alone is a production backend.

## Publication and immutable content
Draft → human review → publish. In one transaction verify options/answer cardinality, rationale, source, objective mapping, domain weights and usable form inventory. Store reviewer/audit data. Never update a published revision in place; add a new question revision and retire the old one for new sessions. Existing sessions keep their assigned revision. Enforce immutability through service permissions and optionally database triggers at implementation.

The seed uses draft status and fictional users. Marking it reviewed to inspect delivery is a test fixture only, not evidence of human exam-content approval.

## Entitlements and billing
Entitlement valid when starts_at <= now < ends_at and revoked_at is null. Preview grants use one stable source_ref per user and feature; the API limits preview creation to once per account. Store events have unique provider event IDs; verify signatures/receipts before writes. Map store ownership to the authenticated user and reject conflicting receipt claims. Receipt verification is not implemented.

Store the entitlement admission snapshot in practice_sessions.selection_config. A learner admitted to a mock may finish it after access expiry. New premium sessions require valid access. Refunds/revocations affect future admission and follow the published policy.

## Circle and notification access
Only active circle members may view its current roster and aggregated study days. Check inviter membership and invite expiry/revocation inside the join transaction, increment use_count under lock, and store only token hashes. FK membership alone does not mean active membership or ownership.

The notification worker can read due jobs and preferences but not question keys or payment payloads. It rechecks activity, entitlement-independent free-study access, quiet hours and enrollment status before sending. Use provider delivery IDs for diagnostics without logging device tokens.

## Data lifecycle
Profiles hold one external auth subject. PII stays out of analytics properties. Exam evidence is a private object reference, never a public URL. The schema uses restrictive foreign keys; do not attempt a blind profile DELETE in production. Implement and test a dependency-aware deletion job that cancels notifications, revokes/deletes private evidence, removes progress/social identity and follows required billing/audit retention. Any retained analytics should be genuinely anonymized, not merely hidden behind a null user_id.

Database schemas and seed create no hosted resources. Run on an empty disposable database. There is no rollback migration, backup job, production grant set, migration framework or deployed service in this package.

