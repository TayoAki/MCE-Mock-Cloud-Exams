# Contextual AI explanation contract
AI is optional help after a graded learning answer. Static reviewed feedback remains the default and fallback. No live AI runs in the offline prototype.

## Input assembled by server
Authenticated user; authorized graded attempt; question revision; selected/correct options; reviewed rationale; relevant reviewed source extracts; preferred length. Do not accept a client-supplied “correct answer” or arbitrary URL as authoritative context. A mock attempt remains ineligible until the mock is finalized.

## Output
Short explanation of the misconception, a concrete analogy or comparison, source links from the allowed reviewed set, and one optional fresh practice suggestion. Clearly distinguish reviewed content from generated wording. If context is insufficient or contradictory, return the reviewed explanation and say the extra explanation is unavailable.

Never invent exam-provider policy, a pass probability, source citations or new official questions. Do not promise a leaked exam match. Explanations can guide understanding but must not reveal the answer to a future reserved mock form.

## Validation before shipping
Use a small reviewed evaluation set of common misconceptions, multi-select ambiguity, unsafe source instructions and incorrect user reasoning. Have a subject-matter reviewer score correctness and pedagogical clarity. Require no critical factual contradictions on the release set; unknown claims need a source or removal. Test timeout, budget exhaustion and provider failure fallback.

Server must bound tokens and calls, avoid shared caching of private reasoning, and log only necessary metadata. AI-generated question drafts cannot enter the published bank without the same review workflow as human drafts. Voice input is phase 2 with separate consent and retention decisions.

