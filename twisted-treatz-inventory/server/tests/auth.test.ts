// ─── Login flows ────────────────────────────────────────────────────
// Admin email+password and team member PIN verification, including
// rate limiting and the no-hash-leakage invariant.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { loginAttempts } from "../src/routes/auth.js";
import { generateAdminToken, generateTeamMemberToken } from "../src/services/tokenService.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;

const PASSWORD = "correct-horse-battery";
const PIN = "4321";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);
const pinHash = bcrypt.hashSync(PIN, 4);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/auth/admin/login", () => {
  const adminRecord = {
    id: 1,
    email: "usman@twistedtreatz.com",
    passwordHash,
    name: "Usman",
    createdAt: new Date(),
    tokenVersion: 0,
  };

  it("returns a token for valid credentials and never leaks the hash", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord);
    const res = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email: adminRecord.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(passwordHash);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("hash");
  });

  it("rejects a wrong password with 401", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord);
    const res = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email: "wrongpw@twistedtreatz.com", password: "nope" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with 401 (same message as wrong password)", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email: "nobody@twistedtreatz.com", password: "whatever" });
    expect(res.status).toBe(401);
  });

  it("rate limits repeated failed attempts", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(adminRecord);
    const email = "ratelimit-target@twistedtreatz.com";

    // Limits are keyed by email AND by source IP; earlier tests in this
    // file share supertest's IP, so failures may flip to 429 before the
    // 5th email-keyed attempt. Either way: only 401s, then only 429s.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/admin/login")
        .send({ email, password: "wrong" });
      expect([401, 429]).toContain(res.status);
    }

    const blocked = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email, password: PASSWORD }); // even the right password is blocked
    expect(blocked.status).toBe(429);
  });

  it("rejects missing fields with 400", async () => {
    const res = await request(app).post("/api/v1/auth/admin/login").send({ email: "x@y.com" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/auth/team/verify", () => {
  const memberRecord = {
    id: 7,
    name: "Jess",
    initials: "JR",
    pinHash,
    active: true,
    createdAt: new Date(),
  };

  it("returns a token for a valid PIN and never leaks the hash", async () => {
    mockPrisma.teamMember.findUnique.mockResolvedValue(memberRecord);
    const res = await request(app)
      .post("/api/v1/auth/team/verify")
      .send({ memberId: 7, pin: PIN });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.member).toEqual({ id: 7, name: "Jess", initials: "JR" });
    expect(JSON.stringify(res.body)).not.toContain(pinHash);
  });

  it("rejects a wrong PIN with 401", async () => {
    mockPrisma.teamMember.findUnique.mockResolvedValue({ ...memberRecord, id: 8 });
    const res = await request(app)
      .post("/api/v1/auth/team/verify")
      .send({ memberId: 8, pin: "0000" });
    expect(res.status).toBe(401);
  });

  it("rejects inactive members even with the right PIN", async () => {
    mockPrisma.teamMember.findUnique.mockResolvedValue({
      ...memberRecord,
      id: 9,
      active: false,
    });
    const res = await request(app)
      .post("/api/v1/auth/team/verify")
      .send({ memberId: 9, pin: PIN });
    expect(res.status).toBe(401);
  });

  it("rate limits after 5 failed PIN attempts for the same member", async () => {
    mockPrisma.teamMember.findUnique.mockResolvedValue({ ...memberRecord, id: 10 });

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/v1/auth/team/verify").send({ memberId: 10, pin: "9999" });
    }

    const blocked = await request(app)
      .post("/api/v1/auth/team/verify")
      .send({ memberId: 10, pin: PIN });
    expect(blocked.status).toBe(429);
  });

  it("rejects a non-numeric memberId with 400 instead of crashing", async () => {
    const res = await request(app)
      .post("/api/v1/auth/team/verify")
      .send({ memberId: "abc", pin: "1234" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/auth/admin/change-password", () => {
  const NEW_PASSWORD = "brand-new-password-2026";
  const adminToken = generateAdminToken({
    id: 1,
    email: "usman@twistedtreatz.com",
    tokenVersion: 0,
  });
  const teamToken = generateTeamMemberToken({ id: 2, name: "Jess", initials: "JR" });

  function change(body: Record<string, unknown>, token = adminToken) {
    return request(app)
      .post("/api/v1/auth/admin/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  beforeEach(() => {
    mockPrisma.admin.findUnique.mockResolvedValue({
      id: 1,
      email: "usman@twistedtreatz.com",
      passwordHash,
      name: "Usman",
      createdAt: new Date(),
      tokenVersion: 0,
    });
    mockPrisma.admin.update.mockResolvedValue({ id: 1, tokenVersion: 1 });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/v1/auth/admin/change-password")
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("rejects team member tokens with 403", async () => {
    const res = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, teamToken);
    expect(res.status).toBe(403);
  });

  it("rejects a wrong current password with 401 and writes nothing", async () => {
    const res = await change({ currentPassword: "wrong-password", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it("changes the password with a correct current password", async () => {
    const res = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    // The new hash actually verifies against the new password
    const written = mockPrisma.admin.update.mock.calls[0][0].data.passwordHash;
    expect(bcrypt.compareSync(NEW_PASSWORD, written)).toBe(true);
    expect(bcrypt.compareSync(PASSWORD, written)).toBe(false);
  });

  it("rejects a new password shorter than 10 chars with 400", async () => {
    const res = await change({ currentPassword: PASSWORD, newPassword: "short" });
    expect(res.status).toBe(400);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it("rejects a new password equal to the current password with 400", async () => {
    const res = await change({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(res.status).toBe(400);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it("never returns a password hash in the response", async () => {
    const res = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("hash");
    expect(JSON.stringify(res.body)).not.toContain(passwordHash);
  });

  it("rate limits after 5 wrong current-password attempts", async () => {
    // Distinct admin id so this test's counter doesn't collide with others
    const token = generateAdminToken({
      id: 55,
      email: "rl@twistedtreatz.com",
      tokenVersion: 0,
    });
    mockPrisma.admin.findUnique.mockResolvedValue({
      id: 55,
      email: "rl@twistedtreatz.com",
      passwordHash,
      name: "RL",
      createdAt: new Date(),
      tokenVersion: 0,
    });

    for (let i = 0; i < 5; i++) {
      const res = await change({ currentPassword: "nope", newPassword: NEW_PASSWORD }, token);
      expect(res.status).toBe(401);
    }
    const blocked = await change(
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      token,
    );
    expect(blocked.status).toBe(429);
  });
});

// Runs LAST: it jumps Date.now past every window opened above, which would
// reset earlier rate-limit state if anything ran after it.
describe("login attempt map sweep", () => {
  const WINDOW_MS = 15 * 60 * 1000;

  it("drops expired entries on later traffic instead of growing forever", async () => {
    mockPrisma.admin.findUnique.mockResolvedValue(null);

    await request(app)
      .post("/api/v1/auth/admin/login")
      .send({ email: "sweep-me@twistedtreatz.com", password: "nope" });
    expect(loginAttempts.has("admin:sweep-me@twistedtreatz.com")).toBe(true);

    // Jump past the window; the next checkRateLimit call sweeps stale keys
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + WINDOW_MS + 60 * 1000);
    try {
      await request(app)
        .post("/api/v1/auth/admin/login")
        .send({ email: "fresh@twistedtreatz.com", password: "nope" });

      expect(loginAttempts.has("admin:sweep-me@twistedtreatz.com")).toBe(false);
      // The live attempt that triggered the sweep is still tracked
      expect(loginAttempts.has("admin:fresh@twistedtreatz.com")).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
