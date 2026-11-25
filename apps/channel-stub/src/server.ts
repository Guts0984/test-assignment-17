import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { channelPushSchema } from '@hotel/shared';
import { verifySignature } from '@hotel/shared/dist/hmac';
import type { StubEnv } from './config/env';
import { PAGE } from './page';
import { createSender, sendSchema } from './sender';
import { createStore } from './state';

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 2_000_000) reject(new Error('body too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const createStub = (env: StubEnv, now: () => Date = () => new Date()): Server => {
  const store = createStore();
  const sender = createSender(env);
  let pushes = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    } else if (req.method === 'GET' && path === '/state') {
      json(res, 200, store.snapshot());
    } else if (req.method === 'GET' && path === '/health') {
      json(res, 200, { ok: true });
    } else if (req.method === 'POST' && path === '/send') {
      const parsed = sendSchema.safeParse(JSON.parse((await readBody(req)) || '{}'));
      if (!parsed.success) return json(res, 400, { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() });
      json(res, 200, { replies: await sender.send(parsed.data) });
    } else if (req.method === 'POST' && path === '/push') {
      const raw = await readBody(req);
      const signature = req.headers['x-signature'];
      if (!verifySignature(env.hmacSecret, raw, typeof signature === 'string' ? signature : undefined)) {
        store.stats.rejected += 1;
        return json(res, 401, { code: 'UNAUTHORIZED', message: 'Bad signature' });
      }
      pushes += 1;
      if (env.chaos && pushes % 5 === 0) {
        store.stats.failedOnPurpose += 1;
        if (pushes % 10 === 0) {
          setTimeout(() => res.destroy(), env.hangMs).unref();
          return;
        }
        return json(res, 500, { code: 'INTERNAL', message: 'Chaos: failing on purpose' });
      }
      const parsed = channelPushSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return json(res, 400, { code: 'VALIDATION_ERROR', message: 'Invalid push' });
      json(res, 200, store.apply(parsed.data, now()) ? { ok: true } : { ignored: true });
    } else {
      json(res, 404, { code: 'NOT_FOUND', message: 'Unknown route' });
    }
  };

  return createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) json(res, 400, { code: 'VALIDATION_ERROR', message: e instanceof Error ? e.message : 'Bad request' });
    });
  });
};
