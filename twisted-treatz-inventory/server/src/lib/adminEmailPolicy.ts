// ─── Admin Email Policy ──────────────────────────────────────────────
// Admin accounts may only use @twistedtreatz.com addresses, so password
// recovery can never be pointed at an outside inbox. The domain is
// hardcoded on purpose: this is company policy for a one-company app,
// and an env-configurable domain would let a bad env var silently
// repeal it.
//
// Any endpoint that creates or changes an admin email MUST call
// isAllowedAdminEmail before writing. Today the only writer is the
// seed script; future admin-management endpoints inherit this contract.

export const ADMIN_EMAIL_DOMAIN = "twistedtreatz.com";

/**
 * True only for well-formed addresses whose domain part exactly equals
 * ADMIN_EMAIL_DOMAIN. Exact match — subdomains (mail.twistedtreatz.com)
 * and lookalikes (evil-twistedtreatz.com) are rejected.
 */
export function isAllowedAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && domain === ADMIN_EMAIL_DOMAIN;
}
