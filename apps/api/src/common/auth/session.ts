import type { Db } from '@hotel/db';
import type { Role } from '@hotel/shared';
import type { StaffIdentity } from './access';
import { verifyToken, type VerifiedToken } from './token';

export interface Session {
  readonly staff: StaffIdentity;
  readonly token: VerifiedToken;
}

/**
 * Who is behind this token right now: a valid signature, not signed out, and the roles the database says
 * today (a role taken away, or an account removed, stops working at once instead of at token expiry).
 */
export const resolveStaff = async (db: Db, token: string, secret: string): Promise<Session | null> => {
  const verified = verifyToken(token, secret);
  if (!verified) return null;
  const [revoked, staff] = await Promise.all([
    db.revokedToken.findUnique({ where: { jti: verified.jti }, select: { jti: true } }),
    db.staff.findUnique({ where: { id: verified.id }, select: { id: true, name: true, roles: { select: { hotelId: true, role: true } } } }),
  ]);
  if (revoked || !staff) return null;
  return { staff: { id: staff.id, name: staff.name, roles: staff.roles.map((r) => ({ hotelId: r.hotelId, role: r.role as Role })) }, token: verified };
};

export const revokeToken = async (db: Db, token: VerifiedToken): Promise<void> => {
  await db.revokedToken.upsert({ where: { jti: token.jti }, create: { jti: token.jti, expiresAt: token.expiresAt }, update: {} });
  await db.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
};
