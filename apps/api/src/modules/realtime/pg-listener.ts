import { Client } from 'pg';
import { z } from 'zod';

const payload = z.object({ hotelId: z.string().uuid(), kind: z.enum(['grid', 'desk', 'rooms']) });

export type HotelChange = z.infer<typeof payload>;

/**
 * LISTENs to `hotel_changed`, which Postgres triggers fire on commit. Works for changes made by any api copy
 * or by the worker. Reconnects with a short delay if the connection drops.
 */
export const startHotelListener = (connectionString: string, onChange: (c: HotelChange) => void, onError: (e: unknown) => void): (() => Promise<void>) => {
  let client: Client | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const connect = async (): Promise<void> => {
    if (stopped) return;
    const c = new Client({ connectionString });
    c.on('notification', (m) => {
      try {
        const parsed = payload.safeParse(JSON.parse(m.payload ?? '{}'));
        if (parsed.success) onChange(parsed.data);
      } catch (e) {
        onError(e);
      }
    });
    const retry = (e: unknown): void => {
      onError(e);
      client = null;
      if (!stopped) timer = setTimeout(() => void connect(), 1000);
    };
    c.on('error', retry);
    c.on('end', () => !stopped && retry(new Error('listener connection ended')));
    try {
      await c.connect();
      await c.query('LISTEN hotel_changed');
      client = c;
    } catch (e) {
      retry(e);
    }
  };
  void connect();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await client?.end().catch(() => undefined);
  };
};
