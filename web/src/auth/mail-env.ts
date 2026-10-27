import { getAuthConfig } from "./config";
import { getMailer } from "./mail";
import type { MailEnv } from "./verification";

/** The mailer and the site address, or null when EMAIL_VERIFICATION is off (then nothing here may send mail). */
export function getMailEnv(): MailEnv | null {
  const { emailVerification, smtp, appUrl } = getAuthConfig();
  return emailVerification && smtp && appUrl ? { mailer: getMailer(smtp), appUrl } : null;
}
