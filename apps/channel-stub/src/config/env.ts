import { z } from 'zod';

const schema = z.object({
  CHANNEL_STUB_PORT: z.coerce.number().int().default(4000),
  CHANNEL_STUB_TARGETS: z.string().min(1),
  CHANNEL_API_KEY: z.string().min(8),
  CHANNEL_HMAC_SECRET: z.string().min(8),
  CHANNEL_STUB_CHAOS: z.enum(['true', 'false']).default('false'),
  /** How long a "hanging" push stays silent; must exceed the worker's CHANNEL_PUSH_TIMEOUT_MS. */
  CHANNEL_STUB_HANG_MS: z.coerce.number().int().positive().default(6000),
});

export interface StubEnv {
  readonly port: number;
  readonly targets: readonly string[];
  readonly apiKey: string;
  readonly hmacSecret: string;
  readonly chaos: boolean;
  readonly hangMs: number;
}

/** The only place that reads the environment. */
export const parseEnv = (source: Readonly<Record<string, string | undefined>>): StubEnv => {
  const p = schema.safeParse(source);
  if (!p.success) throw new Error(`Invalid environment: ${Object.keys(p.error.flatten().fieldErrors).join(', ')}`);
  const e = p.data;
  return {
    port: e.CHANNEL_STUB_PORT,
    targets: e.CHANNEL_STUB_TARGETS.split(',').map((s) => s.trim().replace(/\/$/, '')).filter((s) => s.length > 0),
    apiKey: e.CHANNEL_API_KEY,
    hmacSecret: e.CHANNEL_HMAC_SECRET,
    chaos: e.CHANNEL_STUB_CHAOS === 'true',
    hangMs: e.CHANNEL_STUB_HANG_MS,
  };
};
