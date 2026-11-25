import { Logger } from '@nestjs/common';
import type { WorkerDeps } from '../infra/deps';

export interface EmailData {
  readonly emailId: string;
}

const log = new Logger('mail');

/** "Sends" the mail by logging it. The conditional UPDATE guarantees one send per row. */
export const runEmail = async (deps: Pick<WorkerDeps, 'db' | 'now'>, data: EmailData): Promise<boolean> => {
  const rows = await deps.db.$queryRaw<{ to: string; subject: string; body: string }[]>`
    UPDATE email_outbox SET sent_at = ${deps.now()} WHERE id = ${data.emailId}::uuid AND sent_at IS NULL RETURNING "to", subject, body`;
  const mail = rows[0];
  if (!mail) return false;
  log.log(`mail to ${mail.to}: ${mail.subject} | ${mail.body}`);
  return true;
};
