import nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';

export interface Mail {
  readonly id: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Sends one mail. It throws when the mail server does not take the message, so the job is retried. */
export interface Mailer {
  readonly send: (mail: Mail) => Promise<void>;
}

const log = new Logger('mail');

export const createMailer = (env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'MAIL_FROM'>): Mailer => {
  if (!env.SMTP_HOST) {
    return { send: async (m) => log.log(`mail to ${m.to}: ${m.subject} | ${m.text}`) };
  }
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false, ignoreTLS: true, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10_000 });
  return {
    send: async (m) => {
      // the outbox id is the Message-ID: a repeat after a crash is recognisable as the same mail
      await transport.sendMail({ from: env.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, messageId: `<${m.id}@hotel-chain.test>` });
      log.log(`mail to ${m.to}: ${m.subject}`);
    },
  };
};
