// ─── Removal stock math ─────────────────────────────────────────────
// Stock decrements must be exact, transactional, snapshot before/after,
// refuse to go negative, and be guarded against concurrent removals: the
// decrement is a conditional UPDATE (currentQty >= qty) run inside an
// interactive transaction, never a read-then-write of an absolute value.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateTeamMemberToken } from "../src/services/tokenService.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;
const teamToken = generateTeamMemberToken({ id: 2, name: "Jess", initials: "JR" });

const gummyBears = {
  id: 42,
  name: "Gummy Bears 5lb",
  currentQty: 20,
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.product.findUnique.mockResolvedValue(gummyBears);
  // Guarded decrement matches the row; it reads back 15 (20 - 5)
  mockPrisma.product.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.product.findUniqueOrThrow.mockResolvedValue({ currentQty: 15 });
  mockPrisma.removal.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 1, createdAt: new Date(), ...data })
  );
  // alertService path after a removal
  mockPrisma.alertLog.findFirst.mockResolvedValue(null);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

function removeQty(qty: unknown, productId: unknown = 42) {
  return request(app)
    .post("/api/v1/removals")
    .set("Authorization", `Bearer ${teamToken}`)
    .send({ productId, qty });
}

describe("POST /api/v1/removals — stock math", () => {
  it("decrements stock by exactly the removed qty with before/after snapshots", async () => {
    const res = await removeQty(5);

    expect(res.status).toBe(201);
    expect(res.body.data.removal.qtyBefore).toBe(20);
    expect(res.body.data.removal.qtyAfter).toBe(15);
    // The decrement is guarded by the LIVE qty and applied by the database
    expect(mockPrisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 42, active: true, currentQty: { gte: 5 } },
      data: { currentQty: { decrement: 5 } },
    });
    // Snapshots come from the row read back inside the same transaction
    expect(mockPrisma.removal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ qtyBefore: 20, qtyAfter: 15 }) }),
    );
    // Stock update and removal log run in ONE interactive transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof mockPrisma.$transaction.mock.calls[0][0]).toBe("function");
  });

  it("refuses to remove more than current stock", async () => {
    const res = await removeQty(21);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Insufficient stock");
    expect(mockPrisma.product.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.removal.create).not.toHaveBeenCalled();
  });

  it("refuses when a concurrent change leaves too little stock by the time the decrement runs", async () => {
    // The pre-check saw 20, but the guarded UPDATE matched no row because
    // another request took the units first; the live qty is now 2.
    mockPrisma.product.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.product.findUnique
      .mockResolvedValueOnce(gummyBears)
      .mockResolvedValueOnce({ ...gummyBears, currentQty: 2 });
    const res = await removeQty(5);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Insufficient stock");
    expect(res.body.error).toContain("Current quantity: 2");
    expect(mockPrisma.removal.create).not.toHaveBeenCalled();
  });

  it("allows removing exactly the remaining stock (down to zero)", async () => {
    mockPrisma.product.findUniqueOrThrow.mockResolvedValue({ currentQty: 0 });
    const res = await removeQty(20);
    expect(res.status).toBe(201);
    expect(res.body.data.removal.qtyAfter).toBe(0);
    expect(res.body.data.removal.qtyBefore).toBe(20);
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["non-integer", 1.5],
    ["string", "5"],
    ["missing", undefined],
  ])("rejects %s qty with 400", async (_label, qty) => {
    const res = await removeQty(qty);
    expect(res.status).toBe(400);
    expect(mockPrisma.product.updateMany).not.toHaveBeenCalled();
  });

  it("rejects removals from inactive products with 404", async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ ...gummyBears, active: false });
    const res = await removeQty(1);
    expect(res.status).toBe(404);
  });

  it("rejects removals from unknown products with 404", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    const res = await removeQty(1, 9999);
    expect(res.status).toBe(404);
  });
});
