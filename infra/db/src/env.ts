import { z } from 'zod';

const schema = z.object({
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_USER: z.string().default('hotel'),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().default('hotel'),
  SEED_BOOKINGS_PER_HOTEL: z.coerce.number().int().min(0).default(100_000),
  SEED_HISTORY_DAYS: z.coerce.number().int().min(7).max(365).default(365),
  SEED_PASSWORD: z.string().min(8).default('demo-pass-123'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  databaseUrl: `postgresql://${parsed.data.DB_USER}:${encodeURIComponent(parsed.data.DB_PASSWORD)}@${parsed.data.DB_HOST}:${parsed.data.DB_PORT}/${parsed.data.DB_NAME}`,
});
