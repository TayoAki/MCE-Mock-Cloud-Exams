# Question authoring spec

Every CertPath question is built the same way, whether a person writes it or `generate.ts` drafts it. The method adapts the "delightful answer" interview framework: a weak answer is correct but shallow, and a great one shows depth, trade-offs and judgment. A good exam question turns that into a test, because the shallow answer is the trap and the great answer is the key.

## The five moves

| Move | In an interview answer | In a question item |
|---|---|---|
| 1. The average answer | The common, surface-level answer | The **lead distractor** (`"average": true`): what a candidate with surface knowledge picks. It must be plausible, popular, and wrong for one specific reason: incomplete, outdated, wrong scope or the wrong trade-off. |
| 2. Why it's average | Why that answer falls short | That option's `why`: name the exact gap, meaning what it misses or what breaks. |
| 3. The good answer | Technically correct fundamentals | The **key** (`"correct": true`): correct, current and documented. Its `why` states the mechanism in one to three sentences. |
| 4. The delightful answer | Real-world experience, trade-offs, metrics, business value | `in_practice`: one or two sentences from production, such as a trade-off, a cost, scale or reliability effect, or what the business gets. Use plausible magnitudes framed as examples ("a nightly job over ~2 TB…"); never invent facts about real companies. |
| 5. 5W + 1H | Structure for behavioral questions | Structure for **scenario stems**: **Who** (a data engineer, a platform team), **What** (the data or task), **Where** (catalog, storage, workspace), **When** (schedule, arrival pattern, deadline), **Why** (the constraint: cost, latency, compliance, reliability), **How** (the single thing asked). Difficulty 2 and 3 stems are scenarios. Difficulty 1 may ask directly. |

The tone is the exam's: confident, plain and specific. Start with the actor ("A data engineer…"), end with one clear question ("Which approach meets these requirements?").

## The self-check

Before an item is saved, check each point. `npm run factory:validate` enforces what a program can check.

- ✅ It tests **one fundamental** from its official objective (`guide`).
- ✅ It turns on a **trade-off or comparison**: every distractor is a real alternative a practitioner might choose, not filler.
- ✅ Difficulty 2 and 3 items are a **real-world scenario** (5W + 1H).
- ✅ It connects to **scalability, reliability, cost or business impact** (`in_practice`).
- ✅ It is **clear and structured**: one unambiguous best answer that is **grounded** in the cited page (`evidence`).

## Rules

**Accuracy**
- Every key must be supported by the documentation page in `source`. Put the supporting passage, quoted or closely paraphrased, in `evidence` (30 to 400 characters). If you can't find support, drop the item.
- Use current product names: Lakeflow Jobs, Lakeflow Spark Declarative Pipelines (or Lakeflow Declarative Pipelines), Declarative Automation Bundles, Git folders, Unity Catalog. Older names (Workflows, Delta Live Tables or DLT, Databricks Asset Bundles, Repos) appear only as "(formerly …)".
- Test behavior a practitioner relies on, not trivia. Only use a default value or limit when the docs state it and it matters in practice.
- Write code in SQL when possible, otherwise Python (PySpark), as the exam does.

**Originality**
- Write original items. Don't copy documentation sentences into stems or options. Don't reproduce the exam guide's sample questions, and never use recalled or leaked exam content ("dumps").

**Form**
- `single`: four options, exactly one `correct`, exactly one `average`.
- `multiple`: five options, exactly two `correct`, and the stem ends with "(Choose two.)". Keep multiple-answer items to about 10% of the bank.
- No "all of the above", "none of the above" or "both A and B". No negative stems (NOT, EXCEPT).
- Options are parallel in grammar and similar in length; the key is not noticeably the longest. Options are shuffled at import, so explanations never refer to letters ("option B").
- Set `keep_order` only when options are a natural sequence (numbers, durations, steps).

**Difficulty**
- **1, recall:** recognize a feature, command or term.
- **2, apply:** pick the right tool or setting for a described situation.
- **3, judge:** a scenario with competing constraints, an edge case, or a diagnosis from symptoms.

Aim for about 40% difficulty 1, 35% difficulty 2 and 25% difficulty 3 within each objective.

## Item format

Items live in `api/src/seed/questions/<file>.json` as `{ "items": [ … ] }`. Each item looks like this:

```json
{
  "family": "copy-into-rerun-skips-loaded-files",
  "objective": "ingestion.copy-into",
  "guide": "2.2",
  "difficulty": 2,
  "type": "single",
  "stem": "A data engineer schedules a nightly COPY INTO from an S3 folder into a Unity Catalog table. Last night's run failed halfway, and the engineer reruns the same command this morning without changing anything. What happens to the files that loaded before the failure?",
  "options": [
    { "text": "They are skipped, because COPY INTO tracks which files it has already loaded", "correct": true, "why": "COPY INTO is idempotent: it records the files it has loaded and skips them on later runs, so a rerun only picks up what is new or failed." },
    { "text": "They are loaded again, creating duplicate rows that must be removed with MERGE", "average": true, "why": "Treating COPY INTO like a plain INSERT is the common assumption, but it keeps load state and skips files it has already ingested unless you force it." },
    { "text": "The command fails until the partially loaded files are deleted from the table", "why": "Nothing needs to be cleaned up first; the earlier loaded files are simply skipped." },
    { "text": "They are reloaded only if their modification time is newer than the table's last commit", "why": "Skipping is based on the files COPY INTO has recorded as loaded, not on comparing modification times to the table's commits." }
  ],
  "in_practice": "Idempotent loads make retries safe: an orchestrator can rerun a failed job without a dedup step, which keeps a 30-minute recovery from turning into a manual data-repair session.",
  "source": "https://docs.databricks.com/aws/en/ingestion/cloud-object-storage/copy-into/",
  "evidence": "COPY INTO is retriable and idempotent — files in the source location that have already been loaded are skipped on subsequent runs."
}
```

Field limits:

| Field | Limit |
|---|---|
| `stem` | 60–700 characters |
| Option `text` | 2–220 characters |
| `why` | 40–400 characters |
| `in_practice` | 60–350 characters |
| `evidence` | 30–400 characters |

`family` is a unique kebab-case key and never changes once published, because learners' history follows it.

The stored explanation is composed at import as three paragraphs. The first is the key's `why`. The second is the tempting distractor's `why` followed by the other distractors' `why`. The third is "In practice:" followed by `in_practice`. Write each `why` as a full sentence that names what it talks about, so it reads well in that order.
