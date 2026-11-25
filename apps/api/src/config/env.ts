import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  API_PORT: z.coerce.number().int().default(3000),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_USER: z.string().default('hotel'),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().default('hotel'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_TTL_SEC: z.coerce.number().int().positive().default(28_800),
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  CORS_ORIGINS: z.string().default('http://localhost:8088'),
  BODY_LIMIT: z.string().default('100kb'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:8088'),
  HOLD_MINUTES: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug']).default('log'),
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(600),
  LOGIN_MAX_FAILS_PER_IP_EMAIL: z.coerce.number().int().positive().default(5),
  LOGIN_MAX_FAILS_PER_IP: z.coerce.number().int().positive().default(20),
  LOGIN_MAX_FAILS_PER_EMAIL: z.coerce.number().int().positive().default(50),
  LOGIN_FAIL_WINDOW_SEC: z.coerce.number().int().positive().default(900),
  LOGIN_BLOCK_SEC: z.coerce.number().int().positive().default(900),
  GUEST_LINK_LOOKUPS_PER_MIN: z.coerce.number().int().positive().default(30),
  CHANNEL_RATE_PER_MIN: z.coerce.number().int().positive().default(6000),
  CHANNEL_API_KEY: z.string().min(8),
  CHANNEL_HMAC_SECRET: z.string().min(8),
  CHANNEL_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(3000),
  JOB_ATTEMPTS: z.coerce.number().int().positive().default(8),
  CHANNEL_STUB_CHAOS: bool.default('false'),
});

export type Env = Readonly<z.infer<typeof schema> & { databaseUrl: string; trustedProxies: readonly string[]; corsOrigins: readonly string[] }>;

const list = (v: string): string[] => v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

/** The only place that reads the environment. Pass `process.env` or a test object. */
export const parseEnv = (source: Readonly<Record<string, string | undefined>>): Env => {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
    throw new Error(`Invalid environment: ${fields}`);
  }
  const e = parsed.data;
  return Object.freeze({
    ...e,
    databaseUrl: `postgresql://${e.DB_USER}:${encodeURIComponent(e.DB_PASSWORD)}@${e.DB_HOST}:${e.DB_PORT}/${e.DB_NAME}?connection_limit=30&pool_timeout=30`,
    trustedProxies: Object.freeze(list(e.TRUSTED_PROXY_CIDRS)),
    corsOrigins: Object.freeze(list(e.CORS_ORIGINS)),
  });
};

export const loadEnv = (): Env => parseEnv(process.env);
