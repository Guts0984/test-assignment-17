import { PrismaClient, type Prisma } from '@prisma/client';
import { err, type Result } from '@hotel/shared';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export const createDb = (url: string): Db => new PrismaClient({ datasources: { db: { url } } });

const RETRYABLE = new Set(['40P01', '40001']);

/**
 * One transaction. A deadlock or serialization failure rolls the whole transaction back, so running it again is
 * safe: it is retried a few times before the error reaches the caller. (Lock order is also kept consistent
 * everywhere, so this is a safety net, not the plan.)
 */
export const inTx = async <T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(fn, { maxWait: 30_000, timeout: 30_000 });
    } catch (e) {
      if (attempt >= 4 || !RETRYABLE.has(pgCode(e) ?? '')) throw e;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 30)));
    }
  }
};

/** Metadata written to every journal row. */
export interface Meta {
  readonly reason: string;
  readonly docId: string | null;
  readonly actor: string;
}

export const isUniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/** Postgres error code carried by a raw-query failure (23P01 = exclusion violation, 23514 = check violation). */
export const pgCode = (e: unknown): string | undefined => {
  const meta = (e as { meta?: { code?: string } } | null)?.meta;
  return meta?.code;
};

const ROLLBACK = Symbol('rollback');

interface RollbackSignal {
  readonly [ROLLBACK]: true;
  readonly error: unknown;
}

const isRollback = (e: unknown): e is RollbackSignal => typeof e === 'object' && e !== null && ROLLBACK in e;

/** Runs `fn` in a transaction and rolls it back whenever it returns an error value. */
export const inTxResult = async <T, E>(db: Db, fn: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> => {
  try {
    return await inTx(db, async (tx) => {
      const r = await fn(tx);
      if (!r.ok) throw { [ROLLBACK]: true, error: r.error } satisfies RollbackSignal;
      return r;
    });
  } catch (e) {
    if (isRollback(e)) return err(e.error as E);
    throw e;
  }
};
