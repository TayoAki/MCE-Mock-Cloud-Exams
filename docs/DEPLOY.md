# Deploying CertPath on Railway

CertPath runs as one Railway project with four parts. Only the API talks to the database, and the two web apps reach the API over Railway's private network.

| Service | Source | What it runs |
|---|---|---|
| **Mongo Single Replica** + **Init Single Replica** | Railway template [`dxhww9`](https://railway.com/template/dxhww9) (`railwayapp-templates/mongo-replica-set`) | MongoDB as a single-node replica set with keyfile auth and a volume. The API's grading and completion use transactions, which need a replica set; Railway's plain MongoDB service is standalone. The init service runs once to initiate the set. |
| **api** | This repo, root directory `/api` (`api/Dockerfile`) | The REST API on port 4000, with a public domain for the native app |
| **web** | Root directory `/mobile` (`mobile/Dockerfile`, `mobile/Caddyfile`) | The learner app's web build, served by Caddy, which proxies `/v1` to the API |
| **admin** | Root directory `/admin` (`admin/Dockerfile`, `admin/Caddyfile`) | The backoffice, served the same way |

Because both web apps call `/v1` on their own origin, they need no API URL at build time and no CORS.

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
| `MONGODB_URI` | `mongodb://${{Mongo Single Replica.MONGOUSER}}:${{Mongo Single Replica.MONGOPASSWORD}}@${{Mongo Single Replica.RAILWAY_PRIVATE_DOMAIN}}:27017/certpath?authSource=admin&directConnection=true` |
| `JWT_SECRET` | 64 random hex characters (`openssl rand -hex 32`). Changing it signs everyone out |
| `SEED_ON_START` | `true`: loads the pilot content and the admin account into the empty database on first start. Later starts change nothing |
| `SEED_ADMIN_EMAIL` | `admin@certpath.dev` (the backoffice login) |
| `SEED_ADMIN_PASSWORD` | 16+ random characters. Read it in Railway (**api → Variables**) to sign in to the backoffice. It only applies when the admin is first created; change the password later from the database, not this variable |
| `PLUS_ENABLED` | `false`: CertPath is free, and every learner has every feature |
| `STORE_SANDBOX` | `false` |
| `CORS_ORIGINS` | The web and admin URLs, comma-separated |
| `INVITE_URL_BASE` | `https://<web domain>/join`, so circle invites open the web app |
| `ANTHROPIC_API_KEY` | Optional. With it, "Explain another way" generates explanations with Claude, capped by `AI_DAILY_CALLS_PER_USER` (20) and `AI_DAILY_CALLS_GLOBAL` (2000). Without it, learners see the reviewed explanation |

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

## Turning Plus on later

Set `PLUS_ENABLED=true` on the API once store billing exists. Learners then get the free plan's limits, the 14-day preview and the Plus screens back without an app update. In-app purchase and receipt verification are not built yet (see the root README).

## Costs

Railway bills for CPU, memory, volume storage and egress. This layout runs five small services (two of them static Caddy servers, and the init service only runs once), so check the project's **Usage** page after a few days of real traffic. The MongoDB volume is the only stateful part. Turn on volume backups for **Mongo Single Replica** in Railway before inviting learners.
