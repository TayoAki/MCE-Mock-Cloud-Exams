import { z } from 'zod';

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the process environment.
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
  JWT_TTL: z.string().default('30d'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8081'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** Used when ANTHROPIC_API_KEY isn't set: AI replies go through OpenRouter instead. */
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-opus-5.5'),
  AI_DAILY_CALLS_PER_USER: z.coerce.number().int().nonnegative().default(20),
  AI_DAILY_CALLS_GLOBAL: z.coerce.number().int().nonnegative().default(2000),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /** Off (the default): CertPath is free and every learner has every feature. On: Plus gating, the preview and store purchases. */
  PLUS_ENABLED: bool.default(false),
  STORE_SANDBOX: bool.default(true),
  EXPO_PUSH_ENABLED: bool.default(false),
  INVITE_URL_BASE: z.string().default('certpath://join'),
  DELETION_GRACE_DAYS: z.coerce.number().int().nonnegative().default(7),
  WORKERS_ENABLED: bool.default(true),
  /** Require a different staff member to review a question than the one who wrote it. */
  SEPARATE_REVIEWER: bool.default(false),
  /** Load the pilot content and the admin account into an empty database at startup (no demo learner). */
  SEED_ON_START: bool.default(false),
  SEED_ADMIN_EMAIL: z.string().default('admin@certpath.dev'),
  SEED_ADMIN_PASSWORD: z.string().default('certpath-admin'),
  SEED_DEMO_EMAIL: z.string().default('alex@certpath.dev'),
  SEED_DEMO_PASSWORD: z.string().default('certpath-demo'),
  SOURCE_VERSION: z.string().default('api-0.3.0'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment', z.treeifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;

if (config.NODE_ENV === 'production' && config.JWT_SECRET === 'dev-only-secret-change-me') {
  console.error('JWT_SECRET must be set in production');
  process.exit(1);
}

if (config.NODE_ENV === 'production' && config.SEED_ON_START && (config.SEED_ADMIN_PASSWORD === 'certpath-admin' || config.SEED_ADMIN_PASSWORD.length < 16)) {
  console.error('SEED_ON_START needs a SEED_ADMIN_PASSWORD of at least 16 characters in production');
  process.exit(1);
}

export const corsOrigins = config.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
