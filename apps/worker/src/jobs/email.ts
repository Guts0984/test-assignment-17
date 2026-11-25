import { inTx } from '@hotel/db';
import type { WorkerDeps } from '../infra/deps';

export interface EmailData {
  readonly emailId: string;
}

/**
 * Sends one outbox row. The row is locked (`SKIP LOCKED`) while the mail is handed to the mail server and is
 * marked sent only afterwards, in the same transaction: a refused mail stays unsent and the job is retried,
 * two workers never send the same row at once, and a sent row is skipped by every later run.
 */
export const runEmail = async (deps: Pick<WorkerDeps, 'db' | 'now' | 'mailer'>, data: EmailData): Promise<boolean> =>
  inTx(deps.db, async (tx) => {
    const [mail] = await tx.$queryRaw<{ id: string; to: string; subject: string; body: string }[]>`
      SELECT id::text, "to", subject, body FROM email_outbox WHERE id = ${data.emailId}::uuid AND sent_at IS NULL FOR UPDATE SKIP LOCKED`;
    if (!mail) return false;
    await deps.mailer.send({ id: mail.id, to: mail.to, subject: mail.subject, text: mail.body });
    await tx.$executeRaw`UPDATE email_outbox SET sent_at = ${deps.now()} WHERE id = ${mail.id}::uuid`;
    return true;
  });
