import type { Db } from '@hotel/db';

export interface FolioLineRow {
  readonly id: string;
  readonly kind: 'charge' | 'payment' | 'refund' | 'storno';
  readonly category: string;
  readonly amount: number;
  readonly note: string | null;
  readonly stornoOfId: string | null;
  readonly hotelDate: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export const loadFolio = async (db: Db, bookingId: string): Promise<{ balance: number; lines: FolioLineRow[] }> => {
  const lines = await db.$queryRaw<FolioLineRow[]>`
    SELECT id::text, kind::text, category, amount, note, storno_of_id::text AS "stornoOfId", hotel_date::text AS "hotelDate", created_by AS "createdBy", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM folio_line WHERE booking_id = ${bookingId}::uuid ORDER BY created_at, id`;
  return { balance: lines.reduce((s, l) => s + l.amount, 0), lines };
};
