// ─── Prices are admin-only ──────────────────────────────────────────
// The product read routes accept admin OR team tokens (requireAnyAuth) so
// the floor iPad can browse stock. unitPrice must only ever reach admins:
// a team token gets the same products with every cost field stripped.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  generateAdminToken,
  generateTeamMemberToken,
} from "../src/services/tokenService.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;
const adminToken = generateAdminToken({
  id: 1,
  email: "usman@twistedtreatz.com",
  tokenVersion: 0,
});
const teamToken = generateTeamMemberToken({
  id: 2,
  name: "Jess",
  initials: "JR",
});

function productRow(id: number, unitPrice: string | null) {
  return {
    id,
    name: `Product ${id}`,
    category: "Gummy",
    flavor: null,
    purchaseUnit: "Bag",
    unitSize: null,
    packSize: null,
    uom: null,
    brandId: 3,
    brand: { id: 3, name: "Haribo" },
    supplier: null,
    usedIn: null,
    currentQty: 40,
    alertThreshold: 10,
    unitPrice,
    active: true,
    highRisk: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.product.findMany.mockResolvedValue([
    productRow(1, "12.50"),
    productRow(2, null),
  ]);
  mockPrisma.product.findUnique.mockResolvedValue(productRow(1, "12.50"));
});

describe("GET /api/v1/products — unitPrice visibility", () => {
  it("omits unitPrice from every product for a team token", async () => {
    const res = await request(app)
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${teamToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    for (const product of res.body.data) {
      expect(product).not.toHaveProperty("unitPrice");
      // the rest of the floor-facing shape is intact
      expect(product).toMatchObject({ currentQty: 40, brand: "Haribo" });
    }
    expect(JSON.stringify(res.body)).not.toContain("12.5");
  });

  it("still returns unitPrice for an admin token", async () => {
    const res = await request(app)
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].unitPrice).toBe("12.50");
    expect(res.body.data[1]).toHaveProperty("unitPrice", null);
  });
});

describe("GET /api/v1/products/:id — unitPrice visibility", () => {
  it("omits unitPrice for a team token", async () => {
    const res = await request(app)
      .get("/api/v1/products/1")
      .set("Authorization", `Bearer ${teamToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
    expect(res.body.data).not.toHaveProperty("unitPrice");
  });

  it("still returns unitPrice for an admin token", async () => {
    const res = await request(app)
      .get("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unitPrice).toBe("12.50");
  });
});

describe("other requireAnyAuth reads carry no price data", () => {
  it("GET /products/categories never selects unitPrice", async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ category: "Gummy" }]);
    const res = await request(app)
      .get("/api/v1/products/categories")
      .set("Authorization", `Bearer ${teamToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(["Gummy"]);
    const { select } = mockPrisma.product.findMany.mock.calls[0][0];
    expect(select).not.toHaveProperty("unitPrice");
  });

  it("GET /removals never includes unitPrice for a team token", async () => {
    mockPrisma.removal.findMany.mockResolvedValue([
      {
        id: 7,
        productId: 1,
        product: { name: "Product 1", category: "Gummy", unitPrice: "12.50" },
        teamMemberId: 2,
        teamMember: { name: "Jess" },
        qty: 3,
        qtyBefore: 43,
        qtyAfter: 40,
        createdAt: new Date(),
      },
    ]);
    mockPrisma.removal.count.mockResolvedValue(1);

    const res = await request(app)
      .get("/api/v1/removals")
      .set("Authorization", `Bearer ${teamToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.removals).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("unitPrice");
    const { include } = mockPrisma.removal.findMany.mock.calls[0][0];
    expect(include.product.select).not.toHaveProperty("unitPrice");
  });
});
