import { z } from 'zod';
import { isoDate, uuid } from './schemas';

export const channelEventSchema = z.object({
  channelRef: z.string().min(1).max(100),
  version: z.number().int().min(1),
  type: z.enum(['new', 'modify', 'cancel']),
  hotelId: uuid,
  roomTypeId: uuid,
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z.number().int().min(1).max(10),
  guestName: z.string().max(200).optional(),
  guestEmail: z.string().email().max(200).optional(),
});
export type ChannelEvent = z.infer<typeof channelEventSchema>;

export const channelEventResultSchema = z.object({
  result: z.enum(['accepted', 'created', 'updated', 'cancelled', 'stale', 'pending']),
  bookingCode: z.string().nullable(),
  overbooking: z.boolean(),
});
export type ChannelEventResult = z.infer<typeof channelEventResultSchema>;

/** Body of a price and availability push to the channel. */
export const channelPushSchema = z.object({
  version: z.number().int().min(1),
  roomTypeId: uuid,
  hotelId: uuid,
  sentAt: z.string(),
  nights: z.array(z.object({ night: isoDate, available: z.number().int().min(0), price: z.number().int().nullable(), stopSell: z.boolean() })),
});
export type ChannelPush = z.infer<typeof channelPushSchema>;
