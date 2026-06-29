// ─── Create-product invariants ──────────────────────────────────────
// Creating a SKU must NEVER inject stock without an audit record — a new
// product always lands at currentQty:0, no matter what the body says. The
// PATCH allowlist must not let currentQty through either.

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

function asAdmin(body: Record<string, unknown>) {
  return request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${adminToken}`)
    .send(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  // create echoes the data back with an id + flattened-relation shape
  mockPrisma.product.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 99, createdAt: new Date(), updatedAt: new Date(), brand: null, ...data })
  );
  mockPrisma.product.update.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 1, createdAt: new Date(), updatedAt: new Date(), brand: null, ...data })
  );
});

describe("POST /api/v1/products — create", () => {
  it("ALWAYS creates with currentQty:0, ignoring any qty in the body", async () => {
    const res = await asAdmin({
      name: "New Gummy",
      category: "Gummy",
      purchaseUnit: "Bag",
      currentQty: 9999, // attempted stock injection
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentQty: 0 }) })
    );
    // belt-and-suspenders: the body value never reaches the DB
    const callData = mockPrisma.product.create.mock.calls[0][0].data;
    expect(callData.currentQty).toBe(0);
  });

  it("rejects missing name", async () => {
    const res = await asAdmin({ category: "Gummy", purchaseUnit: "Bag" });
    expect(res.status).toBe(400);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  it("rejects missing category", async () => {
    const res = await asAdmin({ name: "X", purchaseUnit: "Bag" });
    expect(res.status).toBe(400);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  it("rejects missing purchaseUnit", async () => {
    const res = await asAdmin({ name: "X", category: "Gummy" });
    expect(res.status).toBe(400);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  it("rejects a brandId that does not exist", async () => {
    mockPrisma.brand.findUnique.mockResolvedValue(null);
    const res = await asAdmin({
      name: "X",
      category: "Gummy",
      purchaseUnit: "Bag",
      brandId: 1234,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/brand not found/i);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  it("creates with a valid brandId and flattens brand in the response", async () => {
    mockPrisma.brand.findUnique.mockResolvedValue({ id: 3 });
    mockPrisma.product.create.mockResolvedValue({
      id: 99,
      name: "X",
      category: "Gummy",
      purchaseUnit: "Bag",
      currentQty: 0,
      brandId: 3,
      brand: { id: 3, name: "Albanese" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await asAdmin({
      name: "X",
      category: "Gummy",
      purchaseUnit: "Bag",
      brandId: 3,
    });
    expect(res.status).toBe(201);
    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brandId: 3 }) })
    );
    expect(res.body.data.brand).toBe("Albanese");
    expect(res.body.data.brandId).toBe(3);
  });
});

describe("PATCH /api/v1/products/:id — allowlist", () => {
  it("silently drops currentQty (stock never moves via PATCH)", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ currentQty: 5000, alertThreshold: 7 });

    expect(res.status).toBe(200);
    const callData = mockPrisma.product.update.mock.calls[0][0].data;
    expect(callData).not.toHaveProperty("currentQty");
    expect(callData.alertThreshold).toBe(7);
  });

  it("forwards brandId when it references an existing brand", async () => {
    mockPrisma.brand.findUnique.mockResolvedValue({ id: 5 });
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ brandId: 5 });

    expect(res.status).toBe(200);
    const callData = mockPrisma.product.update.mock.calls[0][0].data;
    expect(callData.brandId).toBe(5);
  });

  it("rejects a brandId that does not exist", async () => {
    mockPrisma.brand.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ brandId: 9999 });

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});
