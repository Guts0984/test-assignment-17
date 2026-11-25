import { z } from 'zod';
import { diffDays, isIsoDate } from './dates';
import { isoDate, money, uuid } from './schemas';

export const reportQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    roomTypeId: uuid.optional(),
    source: z.enum(['web', 'channel']).optional(),
  })
  .superRefine((v, ctx) => {
    if (!isIsoDate(v.from) || !isIsoDate(v.to)) return;
    const n = diffDays(v.from, v.to);
    if (n < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '"to" must be after "from"' });
    if (n > 400) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'The period is limited to 400 days' });
  });

const metrics = {
  availableNights: z.number(),
  soldNights: z.number(),
  revenue: money,
  occupancy: z.number(),
  adr: money,
  revPar: money,
};

export const reportSchema = z.object({
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  total: z.object(metrics),
  byRoomType: z.array(z.object({ roomTypeId: z.string(), name: z.string(), ...metrics })),
  bySource: z.array(z.object({ source: z.enum(['web', 'channel']), bookings: z.number(), cancelled: z.number(), noShows: z.number(), soldNights: z.number(), revenue: money })),
});
export type Report = z.infer<typeof reportSchema>;
