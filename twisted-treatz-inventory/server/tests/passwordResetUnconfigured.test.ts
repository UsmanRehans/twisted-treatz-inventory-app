// ─── Forgot-password with NO SendGrid configuration ──────────────────
// Without mail the flow cannot work, so the route must say so instead of
// promising a link. The answer is the same for every address (nothing to
// enumerate) and nothing is looked up or written.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.hoisted(() => {
  delete process.env.SENDGRID_API_KEY;
  delete process.env.ALERT_FROM_EMAIL;
});

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/auth/admin/request-reset without SendGrid", () => {
  it.each(["usman@twistedtreatz.com", "nobody@twistedtreatz.com"])(
    "returns 503 with a clear message for %s and touches nothing",
    async (email) => {
      const res = await request(app)
        .post("/api/v1/auth/admin/request-reset")
        .send({ email });
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("not configured");
      expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.admin.update).not.toHaveBeenCalled();
    },
  );

  it("still validates the body first", async () => {
    const res = await request(app).post("/api/v1/auth/admin/request-reset").send({});
    expect(res.status).toBe(400);
  });
});
