import { createHash, randomBytes } from 'node:crypto';

/** 128-bit random token, URL-safe. */
export const newToken = (): string => randomBytes(16).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const newBookingCode = (): string => {
  const bytes = randomBytes(8);
  return `BK-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
};
