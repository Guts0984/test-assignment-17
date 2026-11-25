import type { Request } from 'express';

/** Express already applied `trust proxy`, so `req.ip` is the real client address. */
export const clientIp = (req: Pick<Request, 'ip' | 'socket'>): string => {
  const raw = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
};
