import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { createMailer } from '../src/infra/mailer';
import { runEmail } from '../src/jobs/email';
import { openDb, testEnv } from './helpers';

const db = openDb(testEnv());
afterAll(async () => {
  await db.$disconnect();
});

interface Received {
  readonly to: string[];
  readonly raw: string;
}

/** A real SMTP server on an ephemeral port that keeps what it receives (or refuses everything). */
const startSmtp = async (refuse = false): Promise<{ port: number; inbox: Received[]; close: () => Promise<void> }> => {
  const inbox: Received[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onRcptTo: (address, _session, cb) => cb(refuse ? Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }) : null),
    onData: (stream, session, cb) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString('utf8') });
        cb();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.server.address() as AddressInfo).port, inbox, close: () => new Promise((r) => server.close(() => r(undefined))) };
};

const outbox = async (to: string, body: string): Promise<string> => {
  const [row] = await db.$queryRaw<{ id: string }[]>`INSERT INTO email_outbox ("to", subject, body) VALUES (${to}, 'Your booking is confirmed', ${body}) RETURNING id::text`;
  return row?.id ?? '';
};

const sentAt = async (id: string): Promise<Date | null> => (await db.$queryRaw<{ s: Date | null }[]>`SELECT sent_at s FROM email_outbox WHERE id = ${id}::uuid`)[0]?.s ?? null;

describe('booking emails over SMTP', () => {
  it('delivers the mail once, with the booking number and the manage link; a repeat sends nothing', async () => {
    const smtp = await startSmtp();
    try {
      const deps = { db, now: () => new Date(), mailer: createMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: smtp.port, MAIL_FROM: 'bookings@hotel-chain.test' }) };
      const id = await outbox('guest@example.test', 'Booking BK-TEST1234. Manage it: http://localhost:8088/manage/abc123');
      const results = await Promise.all([runEmail(deps, { emailId: id }), runEmail(deps, { emailId: id })]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(smtp.inbox).toHaveLength(1);
      expect(smtp.inbox[0]?.to).toEqual(['guest@example.test']);
      expect(smtp.inbox[0]?.raw).toContain('Subject: Your booking is confirmed');
      expect(smtp.inbox[0]?.raw).toContain('BK-TEST1234');
      expect(smtp.inbox[0]?.raw).toContain('http://localhost:8088/manage/abc123');
      expect(await sentAt(id)).not.toBeNull();
      expect(await runEmail(deps, { emailId: id })).toBe(false);
      expect(smtp.inbox).toHaveLength(1);
    } finally {
      await smtp.close();
    }
  });

  it('a refused mail stays unsent and the job fails, so the retry can deliver it later', async () => {
    const refusing = await startSmtp(true);
    const id = await outbox('late@example.test', 'Booking BK-RETRY. Manage it: http://localhost:8088/manage/retry');
    try {
      const failing = { db, now: () => new Date(), mailer: createMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: refusing.port, MAIL_FROM: 'bookings@hotel-chain.test' }) };
      await expect(runEmail(failing, { emailId: id })).rejects.toThrow();
      expect(await sentAt(id)).toBeNull();
    } finally {
      await refusing.close();
    }
    const working = await startSmtp();
    try {
      const deps = { db, now: () => new Date(), mailer: createMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: working.port, MAIL_FROM: 'bookings@hotel-chain.test' }) };
      expect(await runEmail(deps, { emailId: id })).toBe(true);
      expect(working.inbox.map((m) => m.to)).toEqual([['late@example.test']]);
    } finally {
      await working.close();
    }
  });
});
