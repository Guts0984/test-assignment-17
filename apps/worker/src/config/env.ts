import { z } from 'zod';

const schema = z.object({
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_USER: z.string().default('hotel'),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().default('hotel'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CHANNEL_HMAC_SECRET: z.string().min(8),
  CHANNEL_API_KEY: z.string().min(8),
  CHANNEL_PUSH_URL: z.string().url().default('http://localhost:4000/push'),
  CHANNEL_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(3000),
  CHANNEL_PUSH_DAYS: z.coerce.number().int().positive().default(60),
  CHANNEL_PUSH_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  JOB_ATTEMPTS: z.coerce.number().int().positive().default(8),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
});

export type Env = Readonly<z.infer<typeof schema> & { databaseUrl: string }>;

/** The only place that reads the environment. Pass `process.env` or a test object. */
export const parseEnv = (source: Readonly<Record<string, string | undefined>>): Env => {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${Object.keys(parsed.error.flatten().fieldErrors).join(', ')}`);
  }
  const e = parsed.data;
  return Object.freeze({
    ...e,
    databaseUrl: `postgresql://${e.DB_USER}:${encodeURIComponent(e.DB_PASSWORD)}@${e.DB_HOST}:${e.DB_PORT}/${e.DB_NAME}?connection_limit=20&pool_timeout=30`,
  });
};

export const loadEnv = (): Env => parseEnv(process.env);
