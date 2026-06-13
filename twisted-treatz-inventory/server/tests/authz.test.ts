// ─── Authorization matrix ───────────────────────────────────────────
// Every endpoint must enforce its documented access level.
// This suite exists because GET /removals once shipped with no auth.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateAdminToken, generateTeamMemberToken } from "../src/services/tokenService.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;

const adminToken = generateAdminToken({ id: 1, email: "usman@twistedtreatz.com" });
const teamToken = generateTeamMemberToken({ id: 2, name: "Jess", initials: "JR" });

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Generic happy-path data so authorized requests don't 500
  mockPrisma.product.findMany.mockResolvedValue([]);
  mockPrisma.removal.findMany.mockResolvedValue([]);
  mockPrisma.removal.count.mockResolvedValue(0);
  mockPrisma.receipt.findMany.mockResolvedValue([]);
  mockPrisma.receipt.count.mockResolvedValue(0);
  mockPrisma.teamMember.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("GET /api/v1/removals (activity log)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/removals");
    expect(res.status).toBe(401);
  });

  it("rejects garbage tokens", async () => {
    const res = await request(app)
      .get("/api/v1/removals")
      .set(auth("not-a-real-token"));
    expect(res.status).toBe(401);
  });

  it("allows team member tokens", async () => {
    const res = await request(app).get("/api/v1/removals").set(auth(teamToken));
    expect(res.status).toBe(200);
  });

  it("allows admin tokens", async () => {
    const res = await request(app).get("/api/v1/removals").set(auth(adminToken));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/removals", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/removals").send({ productId: 1, qty: 1 });
    expect(res.status).toBe(401);
  });

  it("rejects admin tokens (team members only remove stock)", async () => {
    const res = await request(app)
      .post("/api/v1/removals")
      .set(auth(adminToken))
      .send({ productId: 1, qty: 1 });
    expect(res.status).toBe(403);
  });
});

describe("products endpoints", () => {
  it("GET /products rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/products");
    expect(res.status).toBe(401);
  });

  it("GET /products/categories rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/products/categories");
    expect(res.status).toBe(401);
  });

  it("GET /products allows team member tokens", async () => {
    const res = await request(app).get("/api/v1/products").set(auth(teamToken));
    expect(res.status).toBe(200);
  });

  it("PATCH /products/:id rejects team member tokens (admin only)", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set(auth(teamToken))
      .send({ alertThreshold: 5 });
    expect(res.status).toBe(403);
  });
});

describe("receipts endpoints (admin only)", () => {
  it("POST /receipts rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/receipts").send({});
    expect(res.status).toBe(401);
  });

  it("POST /receipts rejects team member tokens", async () => {
    const res = await request(app)
      .post("/api/v1/receipts")
      .set(auth(teamToken))
      .send({ productId: 1, expectedQty: 1, actualQty: 1 });
    expect(res.status).toBe(403);
  });

  it("GET /receipts rejects team member tokens", async () => {
    const res = await request(app).get("/api/v1/receipts").set(auth(teamToken));
    expect(res.status).toBe(403);
  });
});

describe("admin stats (admin only)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/admin/stats");
    expect(res.status).toBe(401);
  });

  it("rejects team member tokens", async () => {
    const res = await request(app).get("/api/v1/admin/stats").set(auth(teamToken));
    expect(res.status).toBe(403);
  });
});

describe("team members list", () => {
  it("is public for the iPad member-select screen (active members only)", async () => {
    mockPrisma.teamMember.findMany.mockResolvedValue([
      { id: 1, name: "Jess", initials: "JR", active: true },
    ]);
    const res = await request(app).get("/api/v1/team-members");
    expect(res.status).toBe(200);
    expect(mockPrisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } })
    );
  });

  it("ignores ?all=true without an admin token", async () => {
    await request(app).get("/api/v1/team-members?all=true");
    expect(mockPrisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } })
    );
  });

  it("ignores ?all=true with a team member token", async () => {
    await request(app).get("/api/v1/team-members?all=true").set(auth(teamToken));
    expect(mockPrisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } })
    );
  });

  it("honors ?all=true with an admin token", async () => {
    await request(app).get("/api/v1/team-members?all=true").set(auth(adminToken));
    expect(mockPrisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it("PATCH /team-members/:id rejects unauthenticated requests", async () => {
    const res = await request(app).patch("/api/v1/team-members/1").send({ pin: "1234" });
    expect(res.status).toBe(401);
  });
});
