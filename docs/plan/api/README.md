# API handoff
openapi.json is an OpenAPI 3.1 design contract with 21 paths and 27 schemas. The example.invalid server is not deployed. Inspect it with an OpenAPI editor.

Private operations derive identity from a verified bearer token. No client can choose user_id, grade, XP or streak credit. Idempotent mutations use stable keys; a changed payload under a reused key must return 409. Prompt delivery excludes grading fields. Active mock answers return null feedback until finalization.

The contract covers catalog, enrollment, path, session start/resume/answer/finalize, delayed mock feedback, review, progress, contextual explanation, preferences, preview, store verification, outcomes, phase-2 circles and deletion requests.

It is not generated server code. Content administration, actual store callbacks, provider-specific restore details, push registration, guest merge and deletion workers still need dedicated implementation specifications. See database/TRANSACTIONS_AND_ACCESS.md for transaction order and delivery/RETENTION_AND_LEARNING_RULES.md for reward and review semantics.

