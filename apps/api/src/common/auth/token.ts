import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { StaffIdentity } from './access';

const payload = z.object({ sub: z.string(), name: z.string(), jti: z.string(), exp: z.number() });

export const signToken = (staff: StaffIdentity, secret: string, ttlSec: number): string =>
  jwt.sign({ name: staff.name }, secret, { subject: staff.id, expiresIn: ttlSec, algorithm: 'HS256', jwtid: randomUUID() });

export interface VerifiedToken {
  readonly id: string;
  readonly name: string;
  readonly jti: string;
  readonly expiresAt: Date;
}

/** Checks the signature and the expiry only. Roles are NOT read from the token: see `resolveStaff`. */
export const verifyToken = (token: string, secret: string): VerifiedToken | null => {
  try {
    const parsed = payload.safeParse(jwt.verify(token, secret, { algorithms: ['HS256'] }));
    return parsed.success ? { id: parsed.data.sub, name: parsed.data.name, jti: parsed.data.jti, expiresAt: new Date(parsed.data.exp * 1000) } : null;
  } catch {
    return null;
  }
};
