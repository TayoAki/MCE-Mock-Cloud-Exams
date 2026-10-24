# CertPath

A daily learning path with rigorous exam practice for cloud certifications: short five-question lessons, reviewed corrections, spaced review and blueprint-balanced mock exams. The pilot is the **Databricks Data Engineer Associate**; AWS and Microsoft Fabric are listed as planned and cannot be started.

This repository implements the CertPath v2 replan in `docs/plan/` (product, journeys, design, data model and API contract).

| Directory | What it is | Stack |
|---|---|---|
| [`api/`](api/README.md) | REST API for every client | Express 5, TypeScript, MongoDB (Mongoose 9), Passport JWT |
| [`mobile/`](mobile/README.md) | Learner app for iOS and Android (also runs on web) | Expo SDK 57, Expo Router, React Native 0.86, Uniwind, TanStack Query |
| [`admin/`](admin/README.md) | Content review and operations backoffice | Vite, React 19, React Router, TanStack Query, Tailwind v4 |
| [`docs/`](docs/) | [`API.md`](docs/API.md) endpoint reference; `plan/` holds the original bundle | — |

## Quick start

Node 22+. No database to install: the API's dev mode starts an in-memory MongoDB replica set and seeds it.

```bash
npm ci && npm run setup   # installs api/, admin/ and mobile/
npm run dev               # API :4000, learner app (web) :8081, backoffice :5173
```

Open **http://localhost:8081** for the learner app and **http://localhost:5173** for the backoffice. In development both call `/v1` on their own origin, and their dev servers proxy it to the API, so there is no CORS or URL setup. The first load of the learner app bundles it and takes up to about 30 seconds. `npm test` runs the API suite, and `npm run typecheck` checks all three apps.

To run the native app on a simulator or phone, run the API and Expo separately: `npm --prefix api run dev`, then `cd mobile && npx expo start` (press `i` or `a`, or scan the QR code).

### GitHub Codespaces

1. Create a codespace on this branch. The dev container (`.devcontainer/`, Node 22) runs `npm ci && npm run setup`, which takes a few minutes.
2. In the terminal, run `npm run dev` and wait for `[api] CertPath API on http://localhost:4000/v1` and `[mobile] Waiting on http://localhost:8081`.
3. In the **Ports** tab, open **8081** (learner app) and **5173** (backoffice). Ports can stay private: all API calls go through those two dev servers.

A 4-core machine bundles noticeably faster than the default 2-core one. The in-memory database resets whenever the API restarts, including when you edit API code; sign in again or start a new guest.

For a phone in a codespace, stop `npm run dev`, run `npm --prefix api run dev` in one terminal and `cd mobile && npx expo start --tunnel` in another, then scan the QR code. The app reaches the API through the tunnel and Metro's proxy, but this path hasn't been tested. Expo Go must support SDK 57; if the store version only supports a newer SDK, use the web app or a development build.

Seeded logins (development only):

| Who | Email | Password |
|---|---|---|
| Staff (admin + reviewer) | `admin@certpath.dev` | `certpath-admin` |
| Learner | `alex@certpath.dev` | `certpath-demo` |

In the app you can also continue as a guest. On the first lesson, answering **A, B, B, A, D** reproduces the plan's walkthrough: 3/5 correct, +75 XP and a one-day streak.

For a persistent database, run `docker compose up -d mongo`, then `MONGODB_URI=mongodb://localhost:27017/certpath?replicaSet=rs0 npm run seed` in `api/`. `docker compose up api` runs the production build (set `JWT_SECRET`).

## What the plan asked for, and where it lives

**Screens S01–S13** are all implemented in `mobile/src/app/`: choose exam, daily goal, learning path, question, feedback, lesson complete, practice hub, due review, mock setup, mock results, progress, private circle and Plus preview. They are joined by account, settings, exam outcome, custom/timed quiz and circle-invite screens.

**Acceptance criteria F01–F13** (`docs/plan/product/FACTORY_PRD.md`) are each covered by API tests in `api/test/`:

| ID | Requirement | Status |
|---|---|---|
| F01 | Only published, pilot/active banks enroll | Done |
| F02 | Reopening resumes the same lesson and assigned revisions | Done |
| F03 | Server grading, ownership and option checks, one final answer per item | Done |
| F04 | Retry-safe answers and completion with no duplicate XP or credit (tested concurrently) | Done |
| F05 | Reviewed rationale and source on every graded item; AI failures fall back to it | Done |
| F06 | Misses are due tomorrow in the learner's timezone; successes advance 1/3/7/14 days | Done |
| F07 | One study day per local date; timezone changes are prospective | Done |
| F08 | Coverage, new-question accuracy, repeat accuracy, XP and mock scores stay separate | Done |
| F09 | Server mock deadlines keep running; expiry scores unanswered items incorrect and finalizes once | Done |
| F10 | Corrections and due review stay free after Plus ends; admitted mocks can finish | Done |
| F11 | Entitlements only from verified store events; duplicates don't extend; restore | Sandbox verifier only (see below) |
| F12 | Outcomes can pause reminders; "passed" stays self-reported until staff verify | Done |
| F13 | Optional circles; no contact upload; leaving never blocks learning | Done |

The backoffice covers the plan's content workflow: draft → human review → publish with structural checks, immutable revisions, and retirement with an audited repair of learner aggregates. It also has blueprint readiness gates, issue triage, learner support, outcome verification, staff accounts and an audit log.

## Decisions taken in this build

- **MongoDB instead of PostgreSQL.** You specified MongoDB, so the plan's 38-table reference schema became 35 collections. Join tables are embedded and the plan's uniqueness and idempotency constraints are unique indexes; the mapping is in [`api/README.md`](api/README.md). Grading and completion use multi-document transactions, so MongoDB must run as a replica set.
- **"Customer and rider app" is the learner app.** CertPath has no riders, so `mobile/` serves learners and `admin/` serves staff.
- **Content.** The plan shipped five sample questions. To make the path, practice modes and mocks usable, the seed adds 55 original draft questions (60 total) across all seven domains, with answer positions shuffled. **None has had subject-matter review.** The seed marks them reviewed by a fixture account so they can be published, and the backoffice labels them "Dev fixture — not subject-matter approval". With 60 questions the full 45-question mock correctly refuses (the Jobs domain has 5 of the 7 it needs) and offers a labelled 10-question sample instead.
- **Guests are server-side identities.** Grading never happens on the device. Registering upgrades the guest in place, keeping all progress. Merging a guest into a different existing account is not implemented; the sign-in screen says so.
- **AI help** uses Claude at low effort with server-side refusal fallbacks, per-user and global daily caps, and a timeout. The reviewed rationale is shown whenever generation fails, is refused, or no `ANTHROPIC_API_KEY` is set.

## Verification

- **API:** 54 tests (vitest + supertest) against a real MongoDB replica set cover every F-criterion, ownership isolation, concurrent duplicate submissions and completions, mock expiry, entitlement gating, publication and retirement, deletion, reminders and circles. The typecheck and production build pass.
- **Mobile:** typecheck, `expo lint` and `expo-doctor` (21/21) pass, and iOS, Android and web bundles export. A Playwright run of the web build against a live API covers onboarding, a full lesson, Plus gating, completion, practice, review, a sample mock with submit and answer review, progress, account upgrade, the preview, circles, settings and outcome. A second run blocks the network mid-answer, reloads the app, and confirms the same submission ID is retried. The run produced no unexpected errors.
- **Admin:** typecheck and build pass. A Playwright run against a live API covers login, every page, and a full create → review → publish, plus retire, issue resolution, access grants, outcome verification and staff creation.

## Not built yet

These are the plan's open items, kept explicit rather than faked:

- **Store billing.** No StoreKit or Play Billing purchase flow, and no server-side Apple/Google receipt verification (it returns 501). Pricing is illustrative. The sandbox verifier exercises the entitlement logic.
- **Push delivery** is implemented through Expo Push behind `EXPO_PUSH_ENABLED`, but needs an EAS project and a development build, and hasn't been tested on a device.
- **On-device testing.** The app was verified on web and by bundling for iOS and Android, not on a simulator or phone. Native-only modules (SecureStore, notifications, haptics) haven't been exercised at runtime, and there is no VoiceOver or TalkBack audit.
- **Phase 2 extras:** streak freezes, voice explanations, and circle owner transfer. AWS and Fabric banks.
- **Operations:** workers and rate limits run in-process (single instance), sign-in uses a 30-day revocable JWT rather than refresh-token rotation, and there are no migrations, backups, or production deployment.

CertPath is a working title. No affiliation with Databricks, AWS, Microsoft, Duolingo or Pocket Prep is claimed, and practice scores are not pass predictions.
