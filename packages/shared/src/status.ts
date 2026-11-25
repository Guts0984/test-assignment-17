export const BOOKING_STATUSES = ['held', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'expired'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type Actor = 'guest' | 'frontdesk' | 'channel' | 'system';

export interface Transition<S extends string, A extends string> {
  readonly from: S;
  readonly to: S;
  readonly by: readonly A[];
}

export const BOOKING_TRANSITIONS: readonly Transition<BookingStatus, Actor>[] = [
  { from: 'held', to: 'confirmed', by: ['guest'] },
  { from: 'held', to: 'expired', by: ['system'] },
  { from: 'confirmed', to: 'cancelled', by: ['guest', 'frontdesk', 'channel'] },
  { from: 'confirmed', to: 'checked_in', by: ['frontdesk'] },
  { from: 'confirmed', to: 'no_show', by: ['system'] },
  { from: 'checked_in', to: 'checked_out', by: ['frontdesk'] },
];

export const canTransition = (from: BookingStatus, to: BookingStatus, by: Actor): boolean =>
  BOOKING_TRANSITIONS.some((t) => t.from === from && t.to === to && t.by.includes(by));

export const ROOM_STATUSES = ['clean', 'dirty', 'inspected', 'out_of_order'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
export type RoomActor = 'housekeeper' | 'head_housekeeper' | 'frontdesk' | 'system';

export const ROOM_TRANSITIONS: readonly Transition<RoomStatus, RoomActor>[] = [
  { from: 'dirty', to: 'clean', by: ['housekeeper', 'head_housekeeper'] },
  { from: 'clean', to: 'inspected', by: ['head_housekeeper'] },
  { from: 'clean', to: 'dirty', by: ['head_housekeeper', 'frontdesk', 'system'] },
  { from: 'inspected', to: 'dirty', by: ['head_housekeeper', 'frontdesk', 'system'] },
  { from: 'dirty', to: 'out_of_order', by: ['head_housekeeper'] },
  { from: 'clean', to: 'out_of_order', by: ['head_housekeeper'] },
  { from: 'inspected', to: 'out_of_order', by: ['head_housekeeper'] },
  { from: 'out_of_order', to: 'dirty', by: ['head_housekeeper'] },
];

export const canRoomTransition = (from: RoomStatus, to: RoomStatus, by: RoomActor): boolean =>
  ROOM_TRANSITIONS.some((t) => t.from === from && t.to === to && t.by.includes(by));

/** Check-in is allowed only into a clean or inspected room. */
export const isRoomReady = (status: RoomStatus): boolean => status === 'clean' || status === 'inspected';
