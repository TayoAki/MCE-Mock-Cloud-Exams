# CertPath backoffice

The private content-review and operations interface for CertPath staff. Vite, React 19, TypeScript, React Router, TanStack Query and Tailwind CSS v4, styled with the CertPath design tokens (`docs/plan/design/design_tokens.json`).

Only accounts with the `reviewer` or `admin` role can use it. Learner accounts see a "Staff only" screen.

## Run it

```bash
# 1. Start the API (in-memory MongoDB replica set, seeded) from ../api
cd ../api && npm install && npm run dev        # http://localhost:4000/v1

# 2. Start the backoffice
cd ../admin && npm install
cp .env.example .env                           # optional; defaults to http://localhost:4000/v1
npm run dev                                    # http://localhost:5173
```

Sign in with the development seed account `admin@certpath.dev` / `certpath-admin`. The API's `CORS_ORIGINS` must include the backoffice origin (the default does).

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/v1` | API base URL including `/v1` |

`npm run build` typechecks and writes a static bundle to `dist/`. Serve it from any static host with a fallback to `index.html` for client-side routes.

## Pages

| Route | Purpose | API |
|---|---|---|
| `/login` | Staff sign-in | `POST /auth/login` |
| `/` | Seven-day metrics, each with its denominator: weekly active study, activation, study days, bank status, sessions by mode, previews, outcomes, event counts | `GET /admin/overview` |
| `/exams` | Exams and their versions; change exam status and create draft versions (admin) | `GET /admin/exams`, `PATCH /admin/exams/:id`, `POST /admin/exams/:id/versions` |
| `/exam-versions/:id` | Blueprint (domain weights and total, objectives with published/draft counts), learning path units and lessons with a lesson pool editor, readiness checklist, publish (admin). On draft versions admins can delete domains and objectives that nothing uses | `GET/PATCH /admin/exam-versions/:id`, `…/domains`, `…/objectives` (POST, DELETE), `…/units`, `…/lessons`, `…/families`, `…/publish`, `POST /admin/lessons/:id/status` |
| `/questions` | Question bank for the working version, filtered by status, objective, "needs review" and text, with open issue counts | `GET /admin/questions` |
| `/questions/new` | New family + draft revision, with client-side checks that mirror the server's publication rules | `POST /admin/questions` |
| `/questions/:id` | Prompt, keyed options, rationale, source, revisions, audit trail, issue reports, attempt stats. Actions by state: edit draft, approve review, publish, new revision, retire (optionally invalidating past attempts) | `GET/PUT /admin/questions/:id`, `…/review`, `…/publish`, `…/revisions`, `…/retire` |
| `/issues` | Learner issue reports; resolve, dismiss or reopen with a note | `GET/PATCH /admin/issues` |
| `/learners`, `/learners/:id` | Support search and detail: streak, XP, enrollments, access with revoke, outcomes, recent sessions; grant dated access (admin) | `GET /admin/learners`, `GET /admin/learners/:id`, `POST …/entitlements`, `POST /admin/entitlements/:id/revoke` |
| `/outcomes` | Self-reported exam outcomes and their verification status (admin) | `GET/PATCH /admin/outcomes` |
| `/audit` | Staff changes, filterable by entity type and ID | `GET /admin/audit` |
| `/staff` | Staff accounts; admins create reviewers or admins (12+ character initial password) | `GET/POST /admin/staff` |

The sidebar's **working exam version** scopes the question bank and new questions. A question's detail page always uses the question's own exam version.

## Roles

Reviewers can author, review and publish questions, edit objectives, units and lessons, and triage issues. Admin-only actions (exam status, versions, domain weights, deleting domains and objectives, publishing a blueprint, access grants and revocations, outcome verification, creating staff) are hidden or disabled for reviewers, and the API enforces them regardless.

## Content honesty

Seeded questions were marked reviewed by a system fixture account so the learner app can be exercised. The backoffice labels them **"Dev fixture — not subject-matter approval"**; they still need independent expert review. The API can require a different reviewer than the author with `SEPARATE_REVIEWER=true`.

## Session handling

The staff JWT is kept in `localStorage`. Any 401 clears it and returns to the sign-in page; a 403 `insufficient_role` shows a staff-only message. API errors render their `{ code, message, details }` body, including the list of failed checks when publication is blocked.
