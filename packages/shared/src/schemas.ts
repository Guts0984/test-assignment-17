import { z } from 'zod';
import { diffDays, isIsoDate } from './dates';
import { BOOKING_STATUSES } from './status';

export const isoDate = z.string().refine(isIsoDate, { message: 'Expected a date YYYY-MM-DD' });
export const uuid = z.string().uuid();
export const money = z.number().int();

const stayFields = { checkIn: isoDate, checkOut: isoDate, guests: z.number().int().min(1).max(10) };

const stayRefine = (v: { checkIn: string; checkOut: string }, ctx: z.RefinementCtx): void => {
  if (!isIsoDate(v.checkIn) || !isIsoDate(v.checkOut)) return;
  const n = diffDays(v.checkIn, v.checkOut);
  if (n < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkOut'], message: 'Check-out must be after check-in' });
  if (n > 30) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkOut'], message: 'Stay is limited to 30 nights' });
};

const rangeRefine = (v: { from: string; to: string }, ctx: z.RefinementCtx): void => {
  if (isIsoDate(v.from) && isIsoDate(v.to) && diffDays(v.from, v.to) < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '"to" must not be before "from"' });
  }
};

// ---------- auth ----------
export const loginSchema = z.object({ email: z.string().min(1).max(200), password: z.string().min(1).max(200) });
export const roleSchema = z.enum(['admin', 'revenue', 'frontdesk', 'housekeeper', 'head_housekeeper']);
export type Role = z.infer<typeof roleSchema>;
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  staff: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    roles: z.array(z.object({ hotelId: z.string().nullable(), role: roleSchema })),
  }),
});

// ---------- guest ----------
export const hotelListSchema = z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), timezone: z.string(), currency: z.string() }));
export const searchQuerySchema = z
  .object({ hotelId: uuid, ...stayFields, guests: z.coerce.number().int().min(1).max(10) })
  .superRefine(stayRefine);
export const nightPriceSchema = z.object({ date: z.string(), price: money });
export const searchResultSchema = z.object({
  hotel: z.object({ id: z.string(), name: z.string(), currency: z.string(), timezone: z.string() }),
  roomTypes: z.array(
    z.object({
      roomTypeId: z.string(),
      name: z.string(),
      maxGuests: z.number(),
      available: z.number(),
      total: money,
      nights: z.array(nightPriceSchema),
      violations: z.array(z.object({ code: z.string(), date: z.string(), message: z.string() })),
    }),
  ),
});
export const createHoldSchema = z.object({ hotelId: uuid, roomTypeId: uuid, ...stayFields }).superRefine(stayRefine);
export const holdResponseSchema = z.object({
  token: z.string(),
  bookingCode: z.string(),
  expiresAt: z.string(),
  serverNow: z.string(),
  total: money,
  currency: z.string(),
  nights: z.array(nightPriceSchema),
});
export const confirmHoldSchema = z.object({
  guestName: z.string().trim().min(2).max(120),
  guestEmail: z.string().trim().email().max(200),
  guestPhone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone number'),
});
export const bookingViewSchema = z.object({
  code: z.string(),
  status: z.enum(BOOKING_STATUSES),
  hotel: z.object({ id: z.string(), name: z.string(), timezone: z.string(), currency: z.string() }),
  roomType: z.object({ id: z.string(), name: z.string() }),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.number(),
  guestName: z.string().nullable(),
  total: money,
  nights: z.array(nightPriceSchema),
  holdExpiresAt: z.string().nullable(),
  serverNow: z.string(),
  cancellation: z.object({ deadline: z.string(), free: z.boolean(), penalty: money }),
  penalty: money.nullable(),
});
export const confirmResponseSchema = z.object({ code: z.string(), manageUrl: z.string(), booking: bookingViewSchema });
export const changeBookingSchema = z.object(stayFields).superRefine(stayRefine);

// ---------- revenue ----------
export const setRatesSchema = z
  .object({
    roomTypeId: uuid,
    from: isoDate,
    to: isoDate,
    price: z.number().int().positive().optional(),
    adjustPercent: z.number().min(-90).max(500).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  })
  .superRefine(rangeRefine)
  .refine((v) => (v.price === undefined) !== (v.adjustPercent === undefined), { message: 'Give exactly one of price or adjustPercent', path: ['price'] });
export const setRestrictionsSchema = z
  .object({
    roomTypeId: uuid,
    from: isoDate,
    to: isoDate,
    minStay: z.number().int().min(1).max(30).nullable().optional(),
    closedToArrival: z.boolean().optional(),
    closedToDeparture: z.boolean().optional(),
    stopSell: z.boolean().optional(),
  })
  .superRefine(rangeRefine);
export const setOverbookingSchema = z.object({ allowance: z.number().int().min(0).max(50) });
export const updatedCountSchema = z.object({ updated: z.number() });
export const gridQuerySchema = z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(1).max(60).default(60) });
export const gridSchema = z.object({
  from: z.string(),
  days: z.number(),
  roomTypes: z.array(
    z.object({
      roomTypeId: z.string(),
      name: z.string(),
      overbookingAllowance: z.number(),
      nights: z.array(
        z.object({
          date: z.string(),
          total: z.number(),
          ooo: z.number(),
          sold: z.number(),
          held: z.number(),
          free: z.number(),
          price: z.number().nullable(),
          minStay: z.number().nullable(),
          closedToArrival: z.boolean(),
          closedToDeparture: z.boolean(),
          stopSell: z.boolean(),
        }),
      ),
    }),
  ),
});
