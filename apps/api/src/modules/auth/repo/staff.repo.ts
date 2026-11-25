import type { Db } from '@hotel/db';
import type { Role } from '@hotel/shared';

export interface StaffRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly roles: readonly { hotelId: string | null; role: Role }[];
}

export const findStaffByEmail = async (db: Db, email: string): Promise<StaffRecord | null> => {
  const s = await db.staff.findUnique({ where: { email }, include: { roles: true } });
  return s ? { id: s.id, email: s.email, name: s.name, passwordHash: s.passwordHash, roles: s.roles.map((r) => ({ hotelId: r.hotelId, role: r.role })) } : null;
};
