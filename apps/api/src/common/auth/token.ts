import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { roleSchema } from '@hotel/shared';
import type { StaffIdentity } from './access';

const payload = z.object({
  sub: z.string(),
  name: z.string(),
  roles: z.array(z.object({ hotelId: z.string().nullable(), role: roleSchema })),
});

export const signToken = (staff: StaffIdentity, secret: string, ttlSec: number): string =>
  jwt.sign({ name: staff.name, roles: staff.roles }, secret, { subject: staff.id, expiresIn: ttlSec, algorithm: 'HS256' });

export const verifyToken = (token: string, secret: string): StaffIdentity | null => {
  try {
    const parsed = payload.safeParse(jwt.verify(token, secret, { algorithms: ['HS256'] }));
    return parsed.success ? { id: parsed.data.sub, name: parsed.data.name, roles: parsed.data.roles } : null;
  } catch {
    return null;
  }
};
