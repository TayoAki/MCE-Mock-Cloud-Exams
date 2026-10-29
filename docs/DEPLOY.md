# Deploying CertPath on Railway

CertPath runs as one Railway project with four parts. Only the API talks to the database, and the two web apps reach the API over Railway's private network.

| Service | Source | What it runs |
|---|---|---|
| **Mongo Single Replica** + **Init Single Replica** | Railway template [`dxhww9`](https://railway.com/template/dxhww9) (`railwayapp-templates/mongo-replica-set`) | MongoDB as a single-node replica set with keyfile auth and a volume. The API's grading and completion use transactions, which need a replica set; Railway's plain MongoDB service is standalone. The init service runs once to initiate the set. |
| **api** | This repo, root directory `/api` (`api/Dockerfile`) | The REST API on port 4000, with a public domain for the native app |
| **web** | Root directory `/mobile` (`mobile/Dockerfile`, `mobile/Caddyfile`) | The learner app's web build, served by Caddy, which proxies `/v1` to the API |
| **admin** | Root directory `/admin` (`admin/Dockerfile`, `admin/Caddyfile`) | The backoffice, served the same way |

Because both web apps call `/v1` on their own origin, they need no API URL at build time and no CORS.

## Setting it up

1. Deploy the MongoDB template on its own and wait until both of its services have finished. Creating other services while a template is still applying can drop them, and variables that reference a service that doesn't exist yet never bind.
2. When the init service logs "Single node replica initiated successfully", delete it (it has done its job).
3. Create the **api**, **web** and **admin** services, apply the settings and variables below, and generate their domains.
4. Connect each one to this repository and branch. Railway builds on every push to it, but only for the service whose watch paths changed.

## Service settings

| Service | Root directory | Healthcheck | Watch paths |
|---|---|---|---|
| api | `/api` | `/health` (timeout 300 s, so the first start can load the content) | `/api/**` |
| web | `/mobile` | `/` | `/mobile/**` |
| admin | `/admin` | `/` | `/admin/**` |

The watch paths stop a change in one app from rebuilding the others.

## Variables

**api**

| Variable | Value |
|---|---|
| `PORT` | `4000` |
| `MONGODB_URI` | `${{Mongo Single Replica.MONGO_PRIVATE_URL}}/certpath?authSource=admin&directConnection=true` |
| `JWT_SECRET` | 64 random hex characters (`openssl rand -hex 32`). Changing it signs everyone out |
| `SEED_ON_START` | `true`: loads the pilot content and the admin account into the empty database on first start. Later starts change nothing |
| `SEED_ADMIN_EMAIL` | `admin@certpath.dev` (the backoffice login) |
| `SEED_ADMIN_PASSWORD` | 16+ random characters. Read it in Railway (**api → Variables**) to sign in to the backoffice. It only applies when the admin is first created; change the password later from the database, not this variable |
| `PLUS_ENABLED` | `false`: CertPath is free, and every learner has every feature |
| `STORE_SANDBOX` | `false` |
| `CORS_ORIGINS` | The web and admin URLs, comma-separated |
| `INVITE_URL_BASE` | `https://<web domain>/join`, so circle invites open the web app |
| `EXPO_PUSH_ENABLED` | `true` once the TestFlight build has push set up (see below). Until then reminders are planned but not delivered |
| `ANTHROPIC_API_KEY` | Optional. With it, the tutor and "Explain another way" generate replies with Claude, capped by `AI_DAILY_CALLS_PER_USER` (20) and `AI_DAILY_CALLS_GLOBAL` (2000). Without an AI key, learners get reviewed hints and the reviewed explanation |
| `OPENROUTER_API_KEY` | Optional alternative to `ANTHROPIC_API_KEY`: the same features go through OpenRouter. `OPENROUTER_MODEL` picks the model (default `google/gemini-3.1-flash-lite`, $0.25/$1.50 per million input/output tokens; `google/gemini-2.5-flash-lite` costs less, `anthropic/claude-sonnet-5.5` writes better). `OPENROUTER_REASONING_EFFORT` (default `minimal`) keeps the model's thinking short, since it is billed and counts against the reply limit. If both keys are set, Anthropic is used |

**web** and **admin**

| Variable | Value |
|---|---|
| `PORT` | `8080` |
| `API_UPSTREAM` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` |

## Requests and client addresses

Caddy forwards the `X-Forwarded-For` header from Railway's edge unchanged, and the API trusts exactly one proxy hop. Rate limits before sign-in (guest creation, sign-in, registration) therefore key on each learner's address whether a request comes through a web app or straight to the API. Changing either the Caddy `header_up` line or the API's `trust proxy` setting breaks that.

## Pointing the phone app at the hosted API

The native app reads `EXPO_PUBLIC_API_URL`. To try Expo Go against the hosted API instead of a local one:

```bash
cd mobile && EXPO_PUBLIC_API_URL=https://<api domain>/v1 npx expo start --tunnel
```

Store builds (EAS) need the same variable.

## TestFlight builds

```bash
cd mobile
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --latest
```

The app includes an iOS home-screen and Lock Screen widget (`src/widgets/StreakWidget.tsx`), so the build has a second target (`dev.certpath.app.widgets`) and an App Group (`group.dev.certpath.app`). The first build after adding it asks to register the extra bundle identifier and enable App Groups; let EAS do both. Push reminders need the push key EAS offers to create on the same run. Then set `EXPO_PUSH_ENABLED=true` on the API.

## Turning Plus on later

Set `PLUS_ENABLED=true` on the API once store billing exists. Learners then get the free plan's limits, the 14-day preview and the Plus screens back without an app update. In-app purchase and receipt verification are not built yet (see the root README).

## Costs

Railway bills for CPU, memory, volume storage and egress. This layout runs five small services (two of them static Caddy servers, and the init service only runs once), so check the project's **Usage** page after a few days of real traffic. The MongoDB volume is the only stateful part. Turn on volume backups for **Mongo Single Replica** in Railway before inviting learners.
