// ─── Password Reset Email Service ────────────────────────────────────
// Sends the forgot-password reset link via SendGrid. Reuses the same
// SendGrid account/sender as the low-stock alerts. NEVER throws — the
// request-reset endpoint must return a uniform response regardless of
// delivery outcome (anti-enumeration), so errors are logged only.

import sgMail from "@sendgrid/mail";
import {
  passwordResetEmailHtml,
  passwordResetEmailSubject,
} from "./emailTemplates.js";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const ALERT_FROM_EMAIL = process.env.ALERT_FROM_EMAIL;
const APP_BASE_URL =
  process.env.APP_BASE_URL || "https://inventory.twistedtreatz.com";

let sendgridReady = false;

if (SENDGRID_API_KEY && SENDGRID_API_KEY !== "placeholder-set-in-production") {
  sgMail.setApiKey(SENDGRID_API_KEY);
  sendgridReady = true;
} else {
  console.warn(
    "[PasswordReset] SENDGRID_API_KEY is not set or is a placeholder. Reset emails are disabled.",
  );
}

if (!process.env.APP_BASE_URL) {
  console.warn(
    `[PasswordReset] APP_BASE_URL is not set. Reset links will use the default: ${APP_BASE_URL}`,
  );
}

/**
 * Emails a reset link to the admin. The raw token goes in the link only —
 * the DB stores its SHA-256 hash.
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  rawToken: string,
): Promise<void> {
  try {
    if (!sendgridReady || !ALERT_FROM_EMAIL) {
      console.warn(
        "[PasswordReset] Reset email not sent — SendGrid is not configured.",
      );
      return;
    }

    const resetLink = `${APP_BASE_URL}/admin/reset-password?token=${rawToken}`;

    await sgMail.send({
      to: toEmail,
      from: ALERT_FROM_EMAIL,
      subject: passwordResetEmailSubject(),
      html: passwordResetEmailHtml(resetLink),
    });

    console.log(`[PasswordReset] Reset email sent to ${toEmail}`);
  } catch (err) {
    console.error("[PasswordReset] Failed to send reset email:", err);
  }
}
