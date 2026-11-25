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

  const post = async (target: string, ev: ChannelEvent): Promise<ApiReply> => {
    const sent = { channelRef: ev.channelRef, version: ev.version, type: ev.type };
    try {
      const res = await fetch(`${target}/api/channel/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-channel-key': env.apiKey },
        body: JSON.stringify(ev),
        signal: AbortSignal.timeout(15_000),
      });
      return { target, status: res.status, body: await res.json().catch(() => null), sent };
    } catch (e) {
      return { target, status: 0, body: { message: e instanceof Error ? e.message : String(e) }, sent };
    }
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
