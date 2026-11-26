import { z } from 'zod';
import { diffDays, isIsoDate } from './dates';
import { BOOKING_STATUSES, ROOM_STATUSES } from './status';
import { isoDate, money, roleSchema, uuid } from './schemas';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz.includes('/');
  } catch {
    return false;
  }
}, 'Unknown IANA time zone');

// ---------- front desk ----------
export const FRONTDESK_VIEWS = ['arrivals', 'departures', 'inhouse', 'overbooked'] as const;
export const frontdeskQuerySchema = z.object({ view: z.enum(FRONTDESK_VIEWS).default('arrivals'), q: z.string().trim().max(100).optional() });
export const frontdeskRowSchema = z.object({
  bookingId: z.string(),
  code: z.string(),
  status: z.enum(BOOKING_STATUSES),
  guestName: z.string().nullable(),
  roomId: z.string().nullable(),
  roomNumber: z.string().nullable(),
  roomTypeName: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  balance: money,
  overbooking: z.boolean(),
});
export const frontdeskSchema = z.object({ hotelDate: z.string(), view: z.enum(FRONTDESK_VIEWS), bookings: z.array(frontdeskRowSchema) });
export const bookingSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });
export const bookingSearchSchema = z.object({ bookings: z.array(frontdeskRowSchema) });
export const bookingDetailSchema = z.object({
  id: z.string(),
  code: z.string(),
  hotelId: z.string(),
  status: z.enum(BOOKING_STATUSES),
  roomTypeId: z.string(),
  roomTypeName: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.number(),
  guestName: z.string().nullable(),
  guestEmail: z.string().nullable(),
  overbooking: z.boolean(),
  total: money,
  currency: z.string(),
  penalty: money.nullable(),
  nights: z.array(z.object({ date: z.string(), price: money, overbooked: z.boolean() })),
  rooms: z.array(z.object({ roomId: z.string(), number: z.string(), from: z.string(), to: z.string() })),
});
export const roomOptionsSchema = z.object({
  rooms: z.array(z.object({ roomId: z.string(), number: z.string(), roomTypeId: z.string(), roomTypeName: z.string(), status: z.enum(ROOM_STATUSES), ready: z.boolean(), upgrade: z.boolean() })),
});
export const assignRoomSchema = z.object({ roomId: uuid });
export const assignRoomResultSchema = z.object({ upgraded: z.boolean() });
export const extendSchema = z.object({ checkOut: isoDate });
export const extendResultSchema = z.object({ total: money, added: z.number() });
export const resolveOverbookingSchema = z.object({ roomTypeId: uuid, hotelId: uuid.optional() });
export const resolveResultSchema = z.object({ hotelId: z.string(), roomTypeId: z.string() });
export const checkOutResultSchema = z.object({ earlyRelease: z.number() });
export const cancelResultSchema = z.object({ penalty: money });
export const okSchema = z.object({ ok: z.literal(true) });

// ---------- folio ----------
export const FOLIO_CATEGORIES = ['room', 'minibar', 'service', 'penalty', 'cash', 'card'] as const;
export const folioLineInputSchema = z.object({
  kind: z.enum(['charge', 'payment', 'refund']),
  category: z.enum(FOLIO_CATEGORIES),
  amount: z.number().int().positive().max(100_000_000),
  note: z.string().trim().max(200).optional(),
});
export const folioLineSchema = z.object({
  id: z.string(),
  kind: z.enum(['charge', 'payment', 'refund', 'storno']),
  category: z.string(),
  amount: money,
  note: z.string().nullable(),
  stornoOfId: z.string().nullable(),
  hotelDate: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const folioSchema = z.object({ bookingId: z.string(), currency: z.string(), balance: money, lines: z.array(folioLineSchema) });

// ---------- housekeeping ----------
export const hkRoomSchema = z.object({
  id: z.string(),
  number: z.string(),
  roomTypeName: z.string(),
  status: z.enum(ROOM_STATUSES),
  occupied: z.boolean(),
  arrivalToday: z.boolean(),
  housekeeperId: z.string().nullable(),
});
export const hkRoomsSchema = z.object({ hotelDate: z.string(), rooms: z.array(hkRoomSchema) });
export const setRoomStatusSchema = z.object({ status: z.enum(['clean', 'inspected', 'dirty']) });
export const setHousekeeperSchema = z.object({ housekeeperId: uuid.nullable() });
export const outOfOrderSchema = z
  .object({ from: isoDate, to: isoDate, reason: z.string().trim().min(3).max(200) })
  .refine((v) => !isIsoDate(v.from) || !isIsoDate(v.to) || v.to > v.from, { path: ['to'], message: '"to" (exclusive) must be after "from"' })
  .refine((v) => !isIsoDate(v.from) || !isIsoDate(v.to) || diffDays(v.from, v.to) <= 365, { path: ['to'], message: 'A repair period can last at most 365 days' });
export const outOfOrderResultSchema = z.object({ id: z.string(), nights: z.number() });
export const roomStatusResultSchema = z.object({ id: z.string(), status: z.enum(ROOM_STATUSES) });

// ---------- admin ----------
const hotelFields = {
  name: z.string().trim().min(2).max(100),
  timezone,
  currency: z.enum(['UAH', 'PLN', 'EUR']),
  checkInTime: hhmm,
  checkOutTime: hhmm,
  auditTime: hhmm,
  cancelFreeDays: z.number().int().min(0).max(30),
  cancelFreeUntil: hhmm,
};
/** `listed: false` keeps a hotel out of the public list (test hotels); it can still be used by id. */
export const createHotelSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,20}$/), ...hotelFields, listed: z.boolean().default(true) });
export const updateHotelSchema = z.object(hotelFields).partial();
export const hotelSchema = z.object({ id: z.string(), code: z.string(), name: z.string(), timezone: z.string(), currency: z.string(), checkInTime: z.string(), checkOutTime: z.string(), auditTime: z.string(), cancelFreeDays: z.number(), cancelFreeUntil: z.string(), lastClosedDate: z.string() });
export const createRoomTypeSchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(60), rank: z.number().int().min(1).max(20), maxGuests: z.number().int().min(1).max(10) });
export const roomTypeSchema = z.object({ id: z.string(), hotelId: z.string(), code: z.string(), name: z.string(), rank: z.number(), maxGuests: z.number() });
export const createRoomSchema = z.object({ roomTypeId: uuid, number: z.string().trim().min(1).max(10) });
export const roomSchema = z.object({ id: z.string(), hotelId: z.string(), roomTypeId: z.string(), number: z.string(), status: z.enum(ROOM_STATUSES) });
const grants = z.array(z.object({ hotelId: uuid.nullable(), role: roleSchema })).max(50);
export const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(10).max(200),
  roles: grants,
});
export const updateStaffSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), password: z.string().min(10).max(200).optional(), roles: grants.optional() });
export const staffSchema = z.object({ id: z.string(), email: z.string(), name: z.string(), roles: grants });
export const staffListSchema = z.object({ staff: z.array(staffSchema) });
export const setChannelSchema = z.object({ roomTypeIds: z.array(uuid).max(500) });
/** Connect and disconnect single room types without rewriting the whole list (two admins, or two tests, cannot overwrite each other). */
export const changeChannelSchema = z.object({ add: z.array(uuid).max(500).default([]), remove: z.array(uuid).max(500).default([]) });
export const setChannelResultSchema = z.object({ roomTypeIds: z.array(z.string()) });
export const failedJobSchema = z.object({ queue: z.string(), id: z.string(), name: z.string(), failedReason: z.string(), attemptsMade: z.number(), data: z.unknown(), failedAt: z.string().nullable() });
export const failedJobsSchema = z.object({ jobs: z.array(failedJobSchema) });
