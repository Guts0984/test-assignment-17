import { createHmac, timingSafeEqual } from 'node:crypto';

/** Hex HMAC-SHA256 of the raw body. */
export const signBody = (secret: string, body: string | Buffer): string => createHmac('sha256', secret).update(body).digest('hex');

/** Timing-safe check of a hex signature against the raw body. */
export const verifySignature = (secret: string, body: string | Buffer, signature: string | undefined): boolean => {
  if (!signature) return false;
  const expected = Buffer.from(signBody(secret, body), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
};
