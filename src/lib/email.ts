// Tiny SMTP helper. Builds a nodemailer transport from $SMTP_* env vars
// and exposes a single `sendEmail({to, subject, text, html?})`. Returns
// `null` (does not throw) when no SMTP host is configured — callers
// then know to skip / log instead of failing the request.

import { envSmtpConfig } from "./env-config.ts";
import { getLogger } from "./logger.ts";

// deno-lint-ignore no-explicit-any
let cachedTransport: any | null = null;
let probedNoSmtp = false;
const log = getLogger("email");

// deno-lint-ignore no-explicit-any
async function getTransport(): Promise<any | null> {
  if (cachedTransport) return cachedTransport;
  if (probedNoSmtp) return null;
  const smtp = envSmtpConfig();
  if (!smtp) {
    probedNoSmtp = true;
    return null;
  }
  // deno-lint-ignore no-explicit-any
  const nodemailer: any = await import("nodemailer");
  const create = nodemailer.createTransport ??
    nodemailer.default?.createTransport;
  cachedTransport = create({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user
      ? { user: smtp.user, pass: smtp.pass ?? "" }
      : undefined,
  });
  return cachedTransport;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(msg: MailMessage): Promise<boolean> {
  const t = await getTransport();
  if (!t) {
    log.warn("SMTP not configured — would have sent", {
      to: msg.to,
      subject: msg.subject,
    });
    return false;
  }
  const smtp = envSmtpConfig()!;
  try {
    await t.sendMail({
      from: smtp.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    log.info("email sent", { to: msg.to, subject: msg.subject });
    return true;
  } catch (err) {
    log.warn("email send failed", {
      to: msg.to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
