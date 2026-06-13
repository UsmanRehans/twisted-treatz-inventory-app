// ─── Forgot-password flow ───────────────────────────────────────────
// request-reset (anti-enumeration, token issuance, email) and
// reset-password (token validation, single-use, rate limiting).
//
// NOTE: rate limits are keyed per-IP and all supertest requests share one
// IP, so test ORDER inside each describe block is part of the test design —
// the rate-limit test runs last and counts on the budget spent above it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { createMockPrisma } from "./helpers/mockPrisma.js";

// The reset service reads SendGrid config at module load and silently
// no-ops when unconfigured — stub the env before any import runs so the
// email-content assertions below actually exercise the send path.
vi.hoisted(() => {
  process.env.SENDGRID_API_KEY = "test-sendgrid-key";
  process.env.ALERT_FROM_EMAIL = "alerts@twistedtreatz.com";
  process.env.APP_BASE_URL = "https://inventory.twistedtreatz.com";
});

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import sgMail from "@sendgrid/mail";
import { prisma } from "../src/lib/prisma.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;
const mockSend = sgMail.send as ReturnType<typeof vi.fn>;

const ADMIN_EMAIL = "usman@twistedtreatz.com";
const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "brand-new-password-2026";
const oldPasswordHash = bcrypt.hashSync(OLD_PASSWORD, 4);

const adminRecord = {
  id: 1,
  email: ADMIN_EMAIL,
  passwordHash: oldPasswordHash,
  name: "Usman",
  createdAt: new Date(),
  resetTokenHash: null,
  resetTokenExpires: null,
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/auth/admin/request-reset", () => {
  it("returns the identical 200 for unknown and known emails (no enumeration)", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    const unknown = await request(app)
      .post("/api/v1/auth/admin/request-reset")
      .send({ email: "nobody@twistedtreatz.com" });

    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord);
    mockPrisma.admin.update.mockResolvedValue(adminRecord);
    const known = await request(app)
      .post("/api/v1/auth/admin/request-reset")
      .send({ email: ADMIN_EMAIL });

    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);

    // Unknown email writes nothing and sends nothing
    expect(mockPrisma.admin.update).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing email with 400 without burning a rate-limit slot", async () => {
    const res = await request(app)
      .post("/api/v1/auth/admin/request-reset")
      .send({});
    expect(res.status).toBe(400);
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });

  it("stores only the token hash and emails a link with the raw token", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord);
    mockPrisma.admin.update.mockResolvedValue(adminRecord);

    const res = await request(app)
      .post("/api/v1/auth/admin/request-reset")
      .send({ email: ADMIN_EMAIL });
    expect(res.status).toBe(200);

    const written = mockPrisma.admin.update.mock.calls[0][0].data;
    expect(written.resetTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(written.resetTokenExpires.getTime()).toBeGreaterThan(Date.now());

    const emailHtml: string = mockSend.mock.calls[0][0].html;
    const linkMatch = emailHtml.match(/token=([a-f0-9]{64})/);
    expect(linkMatch).not.toBeNull();

    // The emailed token is the preimage of the stored hash — never stored raw
    const rawToken = linkMatch![1];
    expect(sha256(rawToken)).toBe(written.resetTokenHash);
    expect(emailHtml).not.toContain(written.resetTokenHash);

    // Email goes to the admin's own address
    expect(mockSend.mock.calls[0][0].to).toBe(ADMIN_EMAIL);
  });

  it("never leaks hashes in the response", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord);
    mockPrisma.admin.update.mockResolvedValue(adminRecord);

    const res = await request(app)
      .post("/api/v1/auth/admin/request-reset")
      .send({ email: ADMIN_EMAIL });
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("hash");
    expect(JSON.stringify(res.body)).not.toContain(oldPasswordHash);
  });

  it("rate limits repeated requests for the same email (3 / 15 min)", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    const email = "hammered@twistedtreatz.com";

    // Per-email budget is 3; per-IP budget (5) is shared with the tests
    // above, so blocking may arrive via either key. Either way: 200s, then
    // only 429s.
    let blocked = false;
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/api/v1/auth/admin/request-reset")
        .send({ email });
      expect([200, 429]).toContain(res.status);
      if (res.status === 429) blocked = true;
    }
    expect(blocked).toBe(true);

    const final = await request(app)
      .post("/api/v1/auth/admin/request-reset")
      .send({ email });
    expect(final.status).toBe(429);
  });
});

describe("POST /api/v1/auth/admin/reset-password", () => {
  const RAW_TOKEN = crypto.randomBytes(32).toString("hex");
  const adminWithToken = {
    ...adminRecord,
    resetTokenHash: sha256(RAW_TOKEN),
    resetTokenExpires: new Date(Date.now() + 30 * 60 * 1000),
  };

  it("rejects an unknown token with a generic 400", async () => {
    mockPrisma.admin.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/auth/admin/reset-password")
      .send({ token: "deadbeef".repeat(8), newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid or expired reset link");
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it("rejects an expired token with the same generic 400", async () => {
    // The route queries with resetTokenExpires > now, so an expired token
    // simply doesn't match — Prisma returns null
    mockPrisma.admin.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/auth/admin/reset-password")
      .send({ token: RAW_TOKEN, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid or expired reset link");

    // And the lookup itself enforced the expiry window
    const where = mockPrisma.admin.findFirst.mock.calls[0][0].where;
    expect(where.resetTokenExpires.gt).toBeInstanceOf(Date);
  });

  it("rejects a too-short new password with 400 before touching the DB", async () => {
    const res = await request(app)
      .post("/api/v1/auth/admin/reset-password")
      .send({ token: RAW_TOKEN, newPassword: "short" });
    expect(res.status).toBe(400);
    expect(mockPrisma.admin.findFirst).not.toHaveBeenCalled();
  });

  it("looks up by token HASH, never by the raw token", async () => {
    mockPrisma.admin.findFirst.mockResolvedValue(adminWithToken);
    mockPrisma.admin.update.mockResolvedValue(adminWithToken);

    await request(app)
      .post("/api/v1/auth/admin/reset-password")
      .send({ token: RAW_TOKEN, newPassword: NEW_PASSWORD });

    const where = mockPrisma.admin.findFirst.mock.calls[0][0].where;
    expect(where.resetTokenHash).toBe(sha256(RAW_TOKEN));
    expect(where.resetTokenHash).not.toBe(RAW_TOKEN);
  });

  it("sets the new password and nulls the token in one update (single-use)", async () => {
    mockPrisma.admin.findFirst.mockResolvedValue(adminWithToken);
    mockPrisma.admin.update.mockResolvedValue(adminWithToken);

    const res = await request(app)
      .post("/api/v1/auth/admin/reset-password")
      .send({ token: RAW_TOKEN, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const written = mockPrisma.admin.update.mock.calls[0][0].data;
    expect(bcrypt.compareSync(NEW_PASSWORD, written.passwordHash)).toBe(true);
    expect(bcrypt.compareSync(OLD_PASSWORD, written.passwordHash)).toBe(false);
    expect(written.resetTokenHash).toBeNull();
    expect(written.resetTokenExpires).toBeNull();

    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("hash");
  });

  it("rate limits repeated bad-token attempts by IP", async () => {
    mockPrisma.admin.findFirst.mockResolvedValue(null);

    let blocked = false;
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/api/v1/auth/admin/reset-password")
        .send({ token: "deadbeef".repeat(8), newPassword: NEW_PASSWORD });
      expect([400, 429]).toContain(res.status);
      if (res.status === 429) blocked = true;
    }
    expect(blocked).toBe(true);
  });
});
