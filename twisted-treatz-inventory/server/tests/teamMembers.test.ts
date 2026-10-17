// ─── Team members: PIN hashes never leave the API ────────────────────
// GET /team-members is public (iPad member-select) and PATCH /:id stores a
// new PIN hash. Both rely on an explicit Prisma `select` to keep pinHash
// out of the response, so the select itself is what these tests pin.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateAdminToken } from "../src/services/tokenService.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;
const adminToken = generateAdminToken({
  id: 1,
  email: "usman@twistedtreatz.com",
  tokenVersion: 0,
});
const auth = { Authorization: `Bearer ${adminToken}` };
const SAFE_SELECT = { id: true, name: true, initials: true, active: true };
const member = { id: 1, name: "Jess", initials: "JR", active: true };

beforeEach(() => {
  vi.clearAllMocks();
  // Backs requireAdmin's tokenVersion check
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
});

describe("GET /api/v1/team-members", () => {
  it("selects only id/name/initials/active, never pinHash", async () => {
    mockPrisma.teamMember.findMany.mockResolvedValue([member]);
    const res = await request(app).get("/api/v1/team-members");

    expect(res.status).toBe(200);
    const query = mockPrisma.teamMember.findMany.mock.calls[0][0];
    expect(query.select).toEqual(SAFE_SELECT);
    expect(JSON.stringify(res.body)).not.toContain("pinHash");
    expect(res.body.data).toEqual([member]);
  });
});

describe("PATCH /api/v1/team-members/:id", () => {
  it("stores a bcrypt hash of the new PIN and returns the member without it", async () => {
    mockPrisma.teamMember.findUnique.mockResolvedValue({ ...member, pinHash: "$2b$10$old" });
    mockPrisma.teamMember.update.mockResolvedValue(member);

    const res = await request(app)
      .patch("/api/v1/team-members/1")
      .set(auth)
      .send({ pin: "4321" });

    expect(res.status).toBe(200);
    const call = mockPrisma.teamMember.update.mock.calls[0][0];
    expect(call.data.pinHash).toMatch(/^\$2[aby]\$/); // bcrypt, not the raw PIN
    expect(call.data.pinHash).not.toBe("4321");
    expect(call.select).toEqual(SAFE_SELECT);
    expect(JSON.stringify(res.body)).not.toContain("pinHash");
  });

  it("rejects a PIN that is not exactly four digits", async () => {
    mockPrisma.teamMember.findUnique.mockResolvedValue({ ...member, pinHash: "$2b$10$old" });

    for (const pin of ["123", "12345", "12a4", ""]) {
      const res = await request(app)
        .patch("/api/v1/team-members/1")
        .set(auth)
        .send({ pin });
      expect(res.status).toBe(400);
    }
    expect(mockPrisma.teamMember.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown member", async () => {
    mockPrisma.teamMember.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .patch("/api/v1/team-members/42")
      .set(auth)
      .send({ active: false });
    expect(res.status).toBe(404);
    expect(mockPrisma.teamMember.update).not.toHaveBeenCalled();
  });
});
