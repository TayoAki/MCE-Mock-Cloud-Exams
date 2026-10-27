# Question factory

A repeatable pipeline for writing CertPath questions at scale: every question traces back to an official exam objective and a documentation page, follows one authoring method, and passes the same checks before it reaches learners.

```
exam guide ──► blueprint ──► sources ──► scrape ──► draft ──► validate ──► review ──► bank ──► seed
 (PDF)        objectives     doc URLs    markdown   items     checklist    human      JSON     startup
              + targets      per obj.    cache      (person,                          files    import
                                                    agent or
                                                    Claude)
```

## 1. Blueprint: what to write

`src/seed/questions/blueprint.json` maps the official exam guide (Databricks Certified Data Engineer Associate, updated August 6, 2026) to the app's objectives. It holds:

- Every guide objective, by number ("2.3"), with its official text.
- The app objective (`ingestion.auto-loader`) each guide objective is taught under, its domain, and the bank file it lives in.
- How many factory items each objective should have (`target`, counting every batch), sized so each domain matches its exam weight.
- The bank files that hold each objective's items (`files`), one per batch. New items go in the last file, so a batch never rewrites the previous one.
- The difficulty mix (40% recall, 35% apply, 25% judge) and the cap on "Choose two" items (10%).

When the guide changes, update this file first; everything downstream follows from it. To grow the bank, raise the targets and add a new file per objective group; the validator's coverage report then shows what each objective still needs.

## 2. Sources: where the facts come from

`sources.json` lists the official documentation pages for each objective. Every URL is checked to load.

## 3. Scrape: research

```
npm run factory:scrape                                # all objectives
npm run factory:scrape -- --objective jobs.triggers   # one objective
npm run factory:scrape -- --refresh                   # re-download
```

Pages are saved as markdown in `.cache/` (not committed), each headed by its source URL and the date it was fetched. With `FIRECRAWL_API_KEY` set, pages come from Firecrawl's scrape API (`/v2/scrape`, main content only); otherwise from a direct fetch.

## 4. Draft: write the items

Every item follows [AUTHORING.md](./AUTHORING.md), whoever writes it. The spec adapts the "delightful answer" framework:

1. The tempting average answer becomes the lead distractor.
2. Why it falls short becomes that distractor's explanation.
3. The correct fundamentals become the key.
4. The production angle becomes `in_practice`.
5. 5W + 1H shapes the scenario stems.

To draft with Claude:

```
npm run factory:generate -- --objective jobs.triggers --count 5
```

This sends the spec, the objective's official text, its cached documentation and the existing stems (so nothing repeats), and asks for structured JSON. Drafts land in `drafts/` (not committed). It needs `ANTHROPIC_API_KEY` or an `ant auth login` profile.

## 5. Validate: the automated checklist

```
npm run factory:validate                    # the whole bank, with coverage
npm run factory:validate -- --file jobs-2   # one bank file
npm run factory:validate -- --drafts drafts/jobs.triggers-123.json
npm run factory:validate -- --evidence      # also check each evidence quote appears on its source page
```

**Errors** block an item:
- Schema and field lengths.
- Option count, exactly one key (two for "Choose two") and exactly one marked average answer.
- No negative stems, no "all/none of the above", no letter references in explanations.
- A wrong guide/objective pairing.
- A source outside the approved documentation sites.
- Retired product names without "(formerly …)".
- Duplicate family keys, collisions with existing seed questions, and near-duplicate stems.

**Warnings** flag an item for review:
- A key that's much longer than the other options.
- A difficulty 2–3 stem that isn't a scenario with an actor.
- Stems that are close to another stem.
- Too many "Choose two" items.

The same checks run in the API tests, so CI fails on a bad item.

## 6. Review: a person signs off

Check each draft against its `source` page and the `evidence` quote, then:

```
npm run factory:generate -- --promote drafts/jobs.triggers-123.json
```

This appends the error-free items to the objective's bank file. Family keys are permanent once published, because learner history follows them.

## 7. Seed: ship it

`src/seed/questions/index.ts` imports the bank files at startup (`SEED_ON_START`).
- It creates any missing objectives from the blueprint.
- It adds new families idempotently, shuffling options per family so the key's letter carries no signal.
- It composes the explanation as three paragraphs: the key's why; the tempting answer's why and the other options' whys; then "In practice".
- It stores the evidence in the question's reviewer notes.

The bank files stay the source of truth after publishing:
- **Fixing a published question:** edit its item. On the next start the importer publishes the new content as a new revision and retires the old one for new sessions, so learner history stays on the revision it was answered on.
- **Withdrawing a question:** remove the item and add its family key, with the reason, to `src/seed/questions/withdrawn.ts`. The importer retires it, and the validator stops the key from being reused.
- **Staff edits win:** once staff revise a question in the backoffice, the importer leaves that family alone.

The API logs what each start changed, for example `Question bank: 24 added, 3 revised, 1 withdrawn`.

## Status of the bank

The factory holds 422 items in two batches, both written in October 2026 from documentation read that month:

| Batch | Files | Items | Bank after |
|---|---|---|---|
| 1 | `platform`, `ingestion-1`, `ingestion-2`, `transformation-1`, `transformation-2`, `jobs-1`, `jobs-2`, `cicd`, `troubleshooting`, `governance-1`, `governance-2` | 222 | 300 |
| 2 | `platform-2`, `ingestion-3`, `ingestion-4`, `transformation-3`, `transformation-4`, `jobs-3`, `jobs-4`, `cicd-2`, `troubleshooting-2`, `governance-3`, `governance-4` | 200 | 500 |

Batch 2 was written against batch 1, testing facts the earlier questions don't. All of them are drafts. Like the rest of the pilot bank they still need independent subject-matter review before CertPath presents them as reviewed content.
