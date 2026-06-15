// ─── Receiving stock math ───────────────────────────────────────────
// Receipts are the ONLY way stock increases. Increments must be exact
// and validation must catch bad quantities before any write.

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

const sourPatch = {
  id: 7,
  name: "Sour Patch Bulk",
  currentQty: 4,
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Backs the middleware's tokenVersion check
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  mockPrisma.product.findUnique.mockResolvedValue(sourPatch);
  mockPrisma.product.update.mockResolvedValue({ ...sourPatch, currentQty: 16 });
  mockPrisma.receipt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 1, createdAt: new Date(), ...data })
  );
});

function receive(body: Record<string, unknown>) {
  return request(app)
    .post("/api/v1/receipts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(body);
}

describe("POST /api/v1/receipts — stock math", () => {
  it("increments stock by the ACTUAL counted qty (not the expected qty)", async () => {
    const res = await receive({ productId: 7, expectedQty: 10, actualQty: 12, supplier: "Sam's Club" });

    expect(res.status).toBe(201);
    // 4 on hand + 12 actually counted = 16, regardless of the PO saying 10
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentQty: 16 } })
    );
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("records both expected and actual so discrepancies are auditable", async () => {
    const res = await receive({ productId: 7, expectedQty: 10, actualQty: 8 });
    expect(res.status).toBe(201);
    expect(res.body.data.receipt.expectedQty).toBe(10);
    expect(res.body.data.receipt.actualQty).toBe(8);
  });

  it.each([
    ["zero actualQty", { productId: 7, expectedQty: 10, actualQty: 0 }],
    ["negative actualQty", { productId: 7, expectedQty: 10, actualQty: -5 }],
    ["non-integer actualQty", { productId: 7, expectedQty: 10, actualQty: 2.5 }],
    ["missing expectedQty", { productId: 7, actualQty: 10 }],
    ["missing productId", { expectedQty: 10, actualQty: 10 }],
  ])("rejects %s with 400 and writes nothing", async (_label, body) => {
    const res = await receive(body);
    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.receipt.create).not.toHaveBeenCalled();
  });

  it("rejects receipts for inactive products with 404", async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ ...sourPatch, active: false });
    const res = await receive({ productId: 7, expectedQty: 10, actualQty: 10 });
    expect(res.status).toBe(404);
  });
});
