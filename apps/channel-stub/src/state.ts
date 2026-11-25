import type { ChannelPush } from '@hotel/shared';

export interface NightView {
  readonly available: number;
  readonly price: number | null;
  readonly stopSell: boolean;
}

export interface RoomTypeView {
  readonly roomTypeId: string;
  readonly hotelId: string;
  version: number;
  receivedAt: string;
  readonly nights: Map<string, NightView>;
}

/** Availability the channel currently believes in. Versions only move forward. */
export const createStore = () => {
  const roomTypes = new Map<string, RoomTypeView>();
  const stats = { accepted: 0, ignored: 0, rejected: 0, failedOnPurpose: 0 };
  return {
    stats,
    /** Returns false when the version is not greater than the stored one. */
    apply: (push: ChannelPush, now: Date): boolean => {
      const cur = roomTypes.get(push.roomTypeId);
      if (cur && push.version <= cur.version) {
        stats.ignored += 1;
        return false;
      }
      const view: RoomTypeView = cur ?? { roomTypeId: push.roomTypeId, hotelId: push.hotelId, version: 0, receivedAt: '', nights: new Map() };
      view.version = push.version;
      view.receivedAt = now.toISOString();
      for (const n of push.nights) view.nights.set(n.night, { available: n.available, price: n.price, stopSell: n.stopSell });
      roomTypes.set(push.roomTypeId, view);
      stats.accepted += 1;
      return true;
    },
    snapshot: () => ({
      stats,
      roomTypes: [...roomTypes.values()].map((r) => ({
        roomTypeId: r.roomTypeId,
        hotelId: r.hotelId,
        version: r.version,
        receivedAt: r.receivedAt,
        nights: [...r.nights.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([night, v]) => ({ night, ...v })),
      })),
    }),
  };
};

export type Store = ReturnType<typeof createStore>;
