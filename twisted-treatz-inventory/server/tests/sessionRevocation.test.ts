// ─── Admin session revocation ───────────────────────────────────────
// Admin JWTs carry a tokenVersion claim matched against Admin.tokenVersion
// on every admin-authed request. Password change/reset bumps the DB value,
// so every previously issued token dies immediately instead of living out
// its 24h TTL. Tokens minted before the claim existed count as version 0.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { createMockPrisma } from "./helpers/mockPrisma.js";

// The generated @prisma/client auto-loads server/.env on import — partway
// through the app's import chain, AFTER tokenService has already captured
// its secret. Pin JWT_SECRET before any import (dotenv never overrides an
// existing var) so the hand-signed legacy token below uses the same secret
// tokenService does.
vi.hoisted(() => {
  process.env.JWT_SECRET = "session-revocation-test-secret";
});

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateAdminToken } from "../src/services/tokenService.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;

const PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "brand-new-password-2026";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

// Pinned in vi.hoisted above — needed to hand-sign a legacy token
// (one minted before the tokenVersion claim existed)
const JWT_SECRET = "session-revocation-test-secret";

const ADMIN_EMAIL = "usman@twistedtreatz.com";

function adminRecord(tokenVersion: number) {
  return {
    id: 1,
    email: ADMIN_EMAIL,
    passwordHash,
    name: "Usman",
    createdAt: new Date(),
    resetTokenHash: null,
    resetTokenExpires: null,
    tokenVersion,
  };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Happy-path data so authorized requests don't 500
  mockPrisma.receipt.findMany.mockResolvedValue([]);
  mockPrisma.receipt.count.mockResolvedValue(0);
  mockPrisma.removal.findMany.mockResolvedValue([]);
  mockPrisma.removal.count.mockResolvedValue(0);
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("tokenVersion enforcement", () => {
  const tokenV0 = generateAdminToken({ id: 1, email: ADMIN_EMAIL, tokenVersion: 0 });

  it("accepts a token whose version matches the DB (admin-only route)", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(0));
    const res = await request(app).get("/api/v1/receipts").set(auth(tokenV0));
    expect(res.status).toBe(200);
  });

  it("rejects a stale-version token with 401 on admin-only routes", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(1));
    const res = await request(app).get("/api/v1/receipts").set(auth(tokenV0));
    expect(res.status).toBe(401);
  });

  it("rejects a stale-version admin token on shared read routes too (requireAnyAuth)", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(1));
    const res = await request(app).get("/api/v1/removals").set(auth(tokenV0));
    expect(res.status).toBe(401);
  });

  it("accepts a current-version admin token on shared read routes", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(0));
    const res = await request(app).get("/api/v1/removals").set(auth(tokenV0));
    expect(res.status).toBe(200);
  });

  it("rejects a token for an admin that no longer exists", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/api/v1/receipts").set(auth(tokenV0));
    expect(res.status).toBe(401);
  });

  it("treats a legacy token without the claim as version 0", async () => {
    const legacyToken = jwt.sign(
      { type: "admin", adminId: 1, email: ADMIN_EMAIL },
      JWT_SECRET,
      { expiresIn: "24h" },
    );

    // Valid while the DB is still at 0...
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(0));
    const before = await request(app).get("/api/v1/receipts").set(auth(legacyToken));
    expect(before.status).toBe(200);

    // ...and evicted by the first bump like any other pre-bump token
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(1));
    const after = await request(app).get("/api/v1/receipts").set(auth(legacyToken));
    expect(after.status).toBe(401);
  });

  it("no longer honors ?all=true on team-members with a stale token", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(1));
    mockPrisma.teamMember.findMany.mockResolvedValue([]);

    await request(app).get("/api/v1/team-members?all=true").set(auth(tokenV0));
    expect(mockPrisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });
});

describe("change-password revokes sessions and re-issues", () => {
  const tokenV0 = generateAdminToken({ id: 1, email: ADMIN_EMAIL, tokenVersion: 0 });

  it("bumps tokenVersion in the same update as the password and returns a working fresh token", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(0));
    mockPrisma.admin.update.mockResolvedValue({ tokenVersion: 1 });

    const res = await request(app)
      .post("/api/v1/auth/admin/change-password")
      .set(auth(tokenV0))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    // One update writes the hash AND the bump — never two separate calls
    expect(mockPrisma.admin.update).toHaveBeenCalledTimes(1);
    const written = mockPrisma.admin.update.mock.calls[0][0].data;
    expect(written.tokenVersion).toEqual({ increment: 1 });
    expect(bcrypt.compareSync(NEW_PASSWORD, written.passwordHash)).toBe(true);

    const freshToken: string = res.body.data.token;
    expect(freshToken).toBeTruthy();

    // DB is now at version 1: the old token is dead, the fresh one works
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord(1));
    const stale = await request(app).get("/api/v1/receipts").set(auth(tokenV0));
    expect(stale.status).toBe(401);
    const fresh = await request(app).get("/api/v1/receipts").set(auth(freshToken));
    expect(fresh.status).toBe(200);
  });
});
