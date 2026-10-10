// ─── alertThreshold is an integer column ─────────────────────────────
// A decimal threshold used to pass validation, reach Prisma and surface as
// "Internal server error". Both writers must reject it up front.

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
const adminToken = generateAdminToken({ id: 1, email: "usman@twistedtreatz.com", tokenVersion: 0 });
const auth = { Authorization: `Bearer ${adminToken}` };

const product = {
  id: 7,
  name: "Sour Patch Kids 5lb",
  category: "Sour Candy",
  flavor: null,
  purchaseUnit: "Bag",
  unitSize: null,
  packSize: null,
  uom: null,
  brandId: null,
  brand: null,
  supplier: null,
  usedIn: null,
  currentQty: 4,
  alertThreshold: 10,
  unitPrice: null,
  active: true,
  highRisk: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.product.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...product, ...data }),
  );
});

describe("alertThreshold validation", () => {
  it("PATCH rejects a decimal threshold with 400 and writes nothing", async () => {
    const res = await request(app).patch("/api/v1/products/7").set(auth).send({ alertThreshold: 2.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("integer");
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("PATCH accepts a whole-number threshold", async () => {
    const res = await request(app).patch("/api/v1/products/7").set(auth).send({ alertThreshold: 7 });
    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: { alertThreshold: 7 } }),
    );
  });

  it("POST rejects a decimal threshold with 400 and creates nothing", async () => {
    const res = await request(app)
      .post("/api/v1/products")
      .set(auth)
      .send({ name: "New Item", category: "Gummy", purchaseUnit: "Bag", alertThreshold: 2.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("integer");
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });
});
