// No "server-only" or next/* imports. The only place that talks SMTP.
import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config";
import { isPlainAddress } from "./users";

export interface Mail {
  to: string;
  subject: string;
  /** Plain text only: no HTML, so nothing in a message can be made to look like something it is not. */
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Port 465 is TLS from the first byte; any other port must upgrade with STARTTLS or nothing is sent. There is no
 * plaintext option, so the SMTP password never travels in the clear, and the certificate is always verified.
 * Timeouts keep a slow relay from holding a request open.
 */
export function transportOptions(smtp: SmtpConfig) {
  const implicitTls = smtp.port === 465;
  return {
    host: smtp.host,
    port: smtp.port,
    secure: implicitTls,
    requireTLS: !implicitTls,
    auth: { user: smtp.user, pass: smtp.password },
    tls: { minVersion: "TLSv1.2" as const, rejectUnauthorized: true },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // We send text only; these would let a message pull in a local file or a URL.
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

interface Transporter {
  sendMail(message: { from: string; to: { name: string; address: string }; subject: string; text: string }): Promise<unknown>;
}

/** The most one send may take in total, whatever the relay does. The socket timeouts alone do not bound a slow trickle. */
export const SEND_DEADLINE_MS = 30_000;

async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("mail send timed out")), ms);
    timer.unref();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createSmtpMailer(
  smtp: SmtpConfig,
  create: (options: ReturnType<typeof transportOptions>) => Transporter = (o) => nodemailer.createTransport(o),
  deadlineMs = SEND_DEADLINE_MS,
): Mailer {
  const transporter = create(transportOptions(smtp));
  return {
    async send(mail) {
      if (!isPlainAddress(mail.to)) throw new Error("recipient is not a single plain address");
      // An address object, not a string: a string is parsed as an address list.
      await within(transporter.sendMail({ from: smtp.from, to: { name: "", address: mail.to }, subject: mail.subject, text: mail.text }), deadlineMs);
    },
  };
}

// Next bundles pages and actions separately; one mailer per process.
const cache = globalThis as { __mailer?: Mailer };

/** The mailer for this process, built from the validated SMTP settings. */
export function getMailer(smtp: SmtpConfig): Mailer {
  cache.__mailer ??= createSmtpMailer(smtp);
  return cache.__mailer;
}
