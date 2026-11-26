import { isUniqueViolation, type Db } from '@hotel/db';
import { addDays, domainError, err, hotelDateAt, ok, type DomainError, type Result, type Role } from '@hotel/shared';

export interface HotelInput {
  readonly name: string;
  readonly timezone: string;
  readonly currency: 'UAH' | 'PLN' | 'EUR';
  readonly checkInTime: string;
  readonly checkOutTime: string;
  readonly auditTime: string;
  readonly cancelFreeDays: number;
  readonly cancelFreeUntil: string;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

export const toHotel = (h: Omit<HotelInput, 'currency'> & { currency: string; id: string; code: string; lastClosedDate: Date }) => ({
  id: h.id, code: h.code, name: h.name, timezone: h.timezone, currency: h.currency, checkInTime: h.checkInTime, checkOutTime: h.checkOutTime,
  auditTime: h.auditTime, cancelFreeDays: h.cancelFreeDays, cancelFreeUntil: h.cancelFreeUntil, lastClosedDate: day(h.lastClosedDate),
});

/** The new hotel starts with yesterday (by its own clock) as the last closed date. */
export const createHotel = async (db: Db, input: HotelInput & { code: string }, now: Date): Promise<Result<ReturnType<typeof toHotel>, DomainError>> => {
  const lastClosed = addDays(hotelDateAt(now, input.auditTime, input.timezone), -1);
  try {
    return ok(toHotel(await db.hotel.create({ data: { ...input, lastClosedDate: new Date(`${lastClosed}T00:00:00Z`) } })));
  } catch (e) {
    if (isUniqueViolation(e)) return err(domainError('CONFLICT', 'A hotel with this code already exists'));
    throw e;
  }
};

export const updateHotel = async (db: Db, id: string, patch: Partial<HotelInput>) => {
  const exists = await db.hotel.count({ where: { id } });
  return exists === 0 ? null : toHotel(await db.hotel.update({ where: { id }, data: patch }));
};

export const createRoomType = async (db: Db, hotelId: string, input: { code: string; name: string; rank: number; maxGuests: number }): Promise<Result<{ id: string; hotelId: string; code: string; name: string; rank: number; maxGuests: number }, DomainError>> => {
  if ((await db.hotel.count({ where: { id: hotelId } })) === 0) return err(domainError('NOT_FOUND', 'Hotel not found'));
  try {
    const t = await db.roomType.create({ data: { hotelId, ...input } });
    return ok({ id: t.id, hotelId, code: t.code, name: t.name, rank: t.rank, maxGuests: t.maxGuests });
  } catch (e) {
    if (isUniqueViolation(e)) return err(domainError('CONFLICT', 'This room type code already exists in the hotel'));
    throw e;
  }
};

export const createRoom = async (db: Db, hotelId: string, input: { roomTypeId: string; number: string }) => {
  if ((await db.roomType.count({ where: { id: input.roomTypeId, hotelId } })) === 0) return err(domainError('NOT_FOUND', 'Room type not found in this hotel'));
  try {
    const r = await db.room.create({ data: { hotelId, roomTypeId: input.roomTypeId, number: input.number, status: 'clean' } });
    return ok({ id: r.id, hotelId, roomTypeId: r.roomTypeId, number: r.number, status: r.status });
  } catch (e) {
    if (isUniqueViolation(e)) return err(domainError('CONFLICT', 'This room number already exists in the hotel'));
    throw e;
  }
};

export interface Grant {
  readonly hotelId: string | null;
  readonly role: Role;
}

export const validateGrants = async (db: Db, grants: readonly Grant[]): Promise<DomainError | null> => {
  if (grants.some((g) => g.hotelId === null && g.role !== 'admin')) return domainError('VALIDATION_ERROR', 'Only the admin role can be chain-wide');
  const ids = [...new Set(grants.flatMap((g) => (g.hotelId ? [g.hotelId] : [])))];
  if (ids.length > 0 && (await db.hotel.count({ where: { id: { in: ids } } })) !== ids.length) return domainError('VALIDATION_ERROR', 'Unknown hotel in the roles');
  return null;
};

const staffView = (s: { id: string; email: string; name: string; roles: { hotelId: string | null; role: Role }[] }) => ({
  id: s.id, email: s.email, name: s.name, roles: s.roles.map((r) => ({ hotelId: r.hotelId, role: r.role })),
});

export const listStaff = async (db: Db) => (await db.staff.findMany({ include: { roles: true }, orderBy: { email: 'asc' } })).map(staffView);

export const createStaff = async (db: Db, input: { email: string; name: string; passwordHash: string; roles: readonly Grant[] }) => {
  try {
    const s = await db.staff.create({
      data: { email: input.email, name: input.name, passwordHash: input.passwordHash, roles: { create: input.roles.map((r) => ({ hotelId: r.hotelId, role: r.role })) } },
      include: { roles: true },
    });
    return ok(staffView(s));
  } catch (e) {
    if (isUniqueViolation(e)) return err(domainError('CONFLICT', 'This e-mail or role is already taken'));
    throw e;
  }
};

export const updateStaff = async (db: Db, id: string, input: { name?: string; passwordHash?: string; roles?: readonly Grant[] }) =>
  db.$transaction(async (tx) => {
    if (!(await tx.staff.findUnique({ where: { id } }))) return null;
    await tx.staff.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}) } });
    if (input.roles) {
      await tx.staffRole.deleteMany({ where: { staffId: id } });
      await tx.staffRole.createMany({ data: input.roles.map((r) => ({ staffId: id, hotelId: r.hotelId, role: r.role })), skipDuplicates: true });
    }
    return staffView((await tx.staff.findUniqueOrThrow({ where: { id }, include: { roles: true } })));
  });

/** Adds and removes room types in one statement each: it never reads the list first, so parallel changes cannot lose each other. */
export const changeChannelTypes = async (db: Db, add: readonly string[], remove: readonly string[]): Promise<Result<string[], DomainError>> => {
  const wanted = [...new Set(add)];
  if ((await db.roomType.count({ where: { id: { in: wanted } } })) !== wanted.length) return err(domainError('VALIDATION_ERROR', 'Unknown room type in the list'));
  await db.$executeRaw`INSERT INTO channel_room_type (room_type_id) SELECT unnest(${wanted}::uuid[]) ON CONFLICT DO NOTHING`;
  await db.$executeRaw`DELETE FROM channel_room_type WHERE room_type_id = ANY(${[...new Set(remove)]}::uuid[])`;
  return ok([...wanted, ...remove]);
};

export const replaceChannelTypes = async (db: Db, ids: readonly string[]): Promise<Result<string[], DomainError>> => {
  const unique = [...new Set(ids)];
  if ((await db.roomType.count({ where: { id: { in: unique } } })) !== unique.length) return err(domainError('VALIDATION_ERROR', 'Unknown room type in the list'));
  await db.$transaction([db.channelRoomType.deleteMany(), db.channelRoomType.createMany({ data: unique.map((roomTypeId) => ({ roomTypeId })) })]);
  return ok(unique);
};
