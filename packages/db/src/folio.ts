import { domainError, err, ok, type DomainError, type Result } from '@hotel/shared';
import type { Tx } from './client';

export type FolioInput = {
  readonly bookingId: string;
  readonly kind: 'charge' | 'payment' | 'refund';
  readonly category: string;
  /** Positive minor units; the sign is applied here: payments reduce the balance. */
  readonly amount: number;
  readonly note?: string;
  readonly hotelDate: string;
  readonly actor: string;
  /** When set, repeating the same call adds nothing (jobs are idempotent). */
  readonly idemKey?: string;
};

const signed = (kind: FolioInput['kind'], amount: number): number => (kind === 'payment' ? -amount : amount);

/** Appends a line. Returns false when the idempotency key was already used. */
export const addFolioLine = async (tx: Tx, input: FolioInput): Promise<boolean> => {
  const n = await tx.$executeRaw`
    INSERT INTO folio_line (booking_id, kind, category, amount, note, idem_key, hotel_date, created_by)
    VALUES (${input.bookingId}::uuid, ${input.kind}::"FolioKind", ${input.category}, ${signed(input.kind, input.amount)}, ${input.note ?? null},
            ${input.idemKey ?? null}, ${input.hotelDate}::date, ${input.actor})
    ON CONFLICT (idem_key) DO NOTHING`;
  return n === 1;
};

/** Corrections are new lines that reverse an old one; a line can be reversed once. */
export const stornoLine = async (tx: Tx, input: { bookingId: string; lineId: string; hotelDate: string; actor: string; note?: string }): Promise<Result<true, DomainError>> => {
  const [line] = await tx.$queryRaw<{ amount: number; kind: string; category: string }[]>`
    SELECT amount, kind::text, category FROM folio_line WHERE id = ${input.lineId}::uuid AND booking_id = ${input.bookingId}::uuid`;
  if (!line) return err(domainError('NOT_FOUND', 'Folio line not found'));
  if (line.kind === 'storno') return err(domainError('INVALID_STATUS', 'A storno line cannot be reversed'));
  const n = await tx.$executeRaw`
    INSERT INTO folio_line (booking_id, kind, category, amount, note, storno_of_id, hotel_date, created_by)
    VALUES (${input.bookingId}::uuid, 'storno', ${line.category}, ${-line.amount}, ${input.note ?? null}, ${input.lineId}::uuid, ${input.hotelDate}::date, ${input.actor})
    ON CONFLICT (storno_of_id) DO NOTHING`;
  return n === 1 ? ok(true) : err(domainError('CONFLICT', 'This line was already reversed'));
};

export const folioBalance = async (tx: Tx, bookingId: string): Promise<number> => {
  const [r] = await tx.$queryRaw<{ b: bigint | null }[]>`SELECT sum(amount) b FROM folio_line WHERE booking_id = ${bookingId}::uuid`;
  return Number(r?.b ?? 0);
};
