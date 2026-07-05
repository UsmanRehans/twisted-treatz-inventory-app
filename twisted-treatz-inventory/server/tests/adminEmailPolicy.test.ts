// ─── Admin email domain policy ──────────────────────────────────────
// Admin emails must be @twistedtreatz.com exactly — pins the rule any
// future admin-create/update endpoint must enforce.

import { describe, it, expect } from "vitest";
import {
  isAllowedAdminEmail,
  ADMIN_EMAIL_DOMAIN,
} from "../src/lib/adminEmailPolicy.js";

describe("isAllowedAdminEmail", () => {
  it("accepts a company address", () => {
    expect(isAllowedAdminEmail("usman@twistedtreatz.com")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isAllowedAdminEmail("  Hani@TwistedTreatz.COM ")).toBe(true);
  });

  it("rejects outside domains", () => {
    expect(isAllowedAdminEmail("usman@gmail.com")).toBe(false);
  });

  it("rejects subdomains", () => {
    expect(isAllowedAdminEmail("hani@mail.twistedtreatz.com")).toBe(false);
  });

  it("rejects lookalike domains", () => {
    expect(isAllowedAdminEmail("hani@evil-twistedtreatz.com")).toBe(false);
    expect(isAllowedAdminEmail("hani@twistedtreatz.com.evil.com")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isAllowedAdminEmail("")).toBe(false);
    expect(isAllowedAdminEmail("   ")).toBe(false);
    expect(isAllowedAdminEmail("twistedtreatz.com")).toBe(false);
    expect(isAllowedAdminEmail("@twistedtreatz.com")).toBe(false);
    expect(isAllowedAdminEmail("a@b@twistedtreatz.com")).toBe(false);
  });

  it("pins the domain constant", () => {
    expect(ADMIN_EMAIL_DOMAIN).toBe("twistedtreatz.com");
  });
});
