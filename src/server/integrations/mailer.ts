import nodemailer from 'nodemailer';
import { env, isSmtpConfigured } from '../config/env';

export type MailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export type SendMailInput = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: MailAttachment[];
};

const defaultFrom = env.smtpFromEmail
  ? `"${env.smtpFromName}" <${env.smtpFromEmail}>`
  : undefined;

export const mailTransport = isSmtpConfigured
  ? nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass,
      },
    }, defaultFrom ? { from: defaultFrom } : undefined)
  : null;

let verifyPromise: Promise<boolean> | null = null;

type MailEventState = {
  at: string;
  kind: 'startup' | 'test' | 'payroll' | 'generic';
  ok: boolean;
  to?: string | string[];
  subject?: string;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  response?: string;
  error?: string;
};

let lastMailEvent: MailEventState | null = null;

export const setLastMailEvent = (event: MailEventState) => {
  lastMailEvent = event;
};

export const getLastMailEvent = () => lastMailEvent;


export const verifyMailTransport = async () => {
  if (!mailTransport) return false;
  if (!verifyPromise) {
    verifyPromise = mailTransport.verify().then(() => true).catch((error) => {
      verifyPromise = null;
      throw error;
    });
  }
  return verifyPromise;
};

export const sendMailMessage = async (input: SendMailInput) => {
  if (!mailTransport) {
    throw new Error('SMTP mailer is not configured');
  }

  console.log('[MAIL] Sending message', {
    to: input.to,
    cc: input.cc || null,
    bcc: input.bcc || null,
    subject: input.subject,
    attachments: (input.attachments || []).map((item) => item.filename),
  });
  setLastMailEvent({ at: new Date().toISOString(), kind: 'generic', ok: false, to: input.to, subject: input.subject });

  const info = await mailTransport.sendMail({
    from: defaultFrom,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
  });

  console.log('[MAIL] Message sent', {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  });

  setLastMailEvent({
    at: new Date().toISOString(),
    kind: 'generic',
    ok: true,
    to: input.to,
    subject: input.subject,
    messageId: info.messageId,
    accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
    rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
    response: info.response,
  });

  return info;
};

export const getMailerReadiness = () => ({
  configured: isSmtpConfigured,
  hostPresent: Boolean(env.smtpHost),
  userPresent: Boolean(env.smtpUser),
  passPresent: Boolean(env.smtpPass),
  fromEmailPresent: Boolean(env.smtpFromEmail),
  secure: env.smtpSecure,
  port: env.smtpPort,
});
