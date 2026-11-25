import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isoDate, uuid, type ChannelEvent } from '@hotel/shared';
import type { StubEnv } from './config/env';

export const sendSchema = z.object({
  hotelId: uuid,
  roomTypeId: uuid,
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z.number().int().min(1).max(10).default(2),
  count: z.number().int().min(1).max(500).default(1),
  type: z.enum(['new', 'modify', 'cancel']).default('new'),
  channelRef: z.string().min(1).optional(),
  version: z.number().int().min(1).optional(),
});
export type SendInput = z.infer<typeof sendSchema>;

export interface ApiReply {
  readonly target: string;
  readonly status: number;
  readonly body: unknown;
  readonly sent: Pick<ChannelEvent, 'channelRef' | 'version' | 'type'>;
}

interface Known {
  version: number;
}

/** Sends events to the api copies. In chaos mode it duplicates to every copy at once and sometimes sends a cancel first. */
export const createSender = (env: StubEnv) => {
  const known = new Map<string, Known>();
  let lastRef: string | undefined;

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /**
   * One attempt. A real channel does not drop a booking because the other side said "slow down" (429) or was
   * briefly unavailable (5xx, network): it waits for Retry-After and sends the same event again. The api
   * treats a repeat of the same reference and version as the same event, so retrying is always safe.
   */
  const post = async (target: string, ev: ChannelEvent): Promise<ApiReply> => {
    const sent = { channelRef: ev.channelRef, version: ev.version, type: ev.type };
    let last: ApiReply = { target, status: 0, body: null, sent };
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        const res = await fetch(`${target}/api/channel/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-channel-key': env.apiKey },
          body: JSON.stringify(ev),
          signal: AbortSignal.timeout(15_000),
        });
        last = { target, status: res.status, body: await res.json().catch(() => null), sent };
        if (res.status !== 429 && res.status < 500) return last;
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 200 * attempt);
      } catch (e) {
        last = { target, status: 0, body: { message: e instanceof Error ? e.message : String(e) }, sent };
        await sleep(200 * attempt);
      }
    }
    return last;
  };

  const fanOut = (ev: ChannelEvent, both: boolean, i: number): Promise<ApiReply[]> => {
    const targets = both ? env.targets : [env.targets[i % env.targets.length] ?? ''];
    return Promise.all(targets.map((t) => post(t, ev)));
  };

  const one = async (input: SendInput, i: number): Promise<ApiReply[]> => {
    const base = { hotelId: input.hotelId, roomTypeId: input.roomTypeId, checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests, guestName: 'Channel Guest', guestEmail: 'ota-guest@example.com' };
    const ref = input.type === 'new' ? (input.channelRef ?? `STUB-${randomUUID()}`) : (input.channelRef ?? lastRef ?? '');
    const version = input.version ?? (input.type === 'new' ? 1 : (known.get(ref)?.version ?? 1) + 1);
    const out: ApiReply[] = [];
    if (env.chaos && input.type === 'new' && Math.random() < 0.3) {
      out.push(...(await fanOut({ ...base, channelRef: ref, version: version + 1, type: 'cancel' }, true, i)));
      known.set(ref, { version: version + 1 });
    } else if (!known.has(ref) || input.version === undefined) {
      known.set(ref, { version: Math.max(version, known.get(ref)?.version ?? 0) });
    }
    out.push(...(await fanOut({ ...base, channelRef: ref, version, type: input.type }, env.chaos, i)));
    lastRef = ref;
    return out;
  };

  return {
    send: async (input: SendInput): Promise<ApiReply[]> => (await Promise.all(Array.from({ length: input.count }, (_, i) => one(input, i)))).flat(),
  };
};
