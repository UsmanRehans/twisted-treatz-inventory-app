// ─── Brand entity ───────────────────────────────────────────────────
// Brands are admin-managed metadata. Names are normalized before write and
// the @unique index is the dedup backstop (duplicate → 409). Soft-delete
// only — no hard DELETE route.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
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
const adminToken = generateAdminToken({ id: 1, email: "usman@twistedtreatz.com", tokenVersion: 0 });
const teamToken = generateTeamMemberToken({ id: 2, name: "Jess", initials: "JR" });

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
  "Unique constraint failed on the fields: (`name`)",
  { code: "P2002", clientVersion: "test" }
);

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.brand.findMany.mockResolvedValue([]);
  mockPrisma.brand.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 10, active: true, ...data })
  );
  mockPrisma.brand.update.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 10, name: "Albanese", active: true, ...data })
  );
});

describe("GET /api/v1/brands", () => {
  it("is readable by team members (requireAnyAuth)", async () => {
    const res = await request(app).get("/api/v1/brands").set(auth(teamToken));
    expect(res.status).toBe(200);
    expect(mockPrisma.brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } })
    );
  });
});

describe("POST /api/v1/brands", () => {
  it("normalizes the name before storing", async () => {
    const res = await request(app)
      .post("/api/v1/brands")
      .set(auth(adminToken))
      .send({ name: "  albanese   direct " });
    expect(res.status).toBe(201);
    expect(mockPrisma.brand.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Albanese Direct" } })
    );
  });

  it("returns 409 on a duplicate name", async () => {
    mockPrisma.brand.create.mockRejectedValue(uniqueViolation);
    const res = await request(app)
      .post("/api/v1/brands")
      .set(auth(adminToken))
      .send({ name: "Albanese" });
    expect(res.status).toBe(409);
  });

  it("rejects an empty name", async () => {
    const res = await request(app)
      .post("/api/v1/brands")
      .set(auth(adminToken))
      .send({ name: "   " });
    expect(res.status).toBe(400);
    expect(mockPrisma.brand.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/brands/:id", () => {
  it("soft-deletes via active:false", async () => {
    const res = await request(app)
      .patch("/api/v1/brands/10")
      .set(auth(adminToken))
      .send({ active: false });
    expect(res.status).toBe(200);
    const callData = mockPrisma.brand.update.mock.calls[0][0].data;
    expect(callData.active).toBe(false);
  });
});
