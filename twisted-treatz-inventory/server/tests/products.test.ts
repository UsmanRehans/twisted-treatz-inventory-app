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

  it("accepts and trims the detail fields (purchaseUnit, flavor, supplier, usedIn)", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        purchaseUnit: "  Case ",
        flavor: " Sour Apple ",
        supplier: " Sams Club ",
        usedIn: " Gummy Mix ",
      });

    expect(res.status).toBe(200);
    const callData = mockPrisma.product.update.mock.calls[0][0].data;
    expect(callData.purchaseUnit).toBe("Case");
    expect(callData.flavor).toBe("Sour Apple");
    expect(callData.supplier).toBe("Sams Club");
    expect(callData.usedIn).toBe("Gummy Mix");
  });

  it("lets optional detail fields be cleared with null or empty string", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ flavor: null, supplier: "   ", usedIn: null });

    expect(res.status).toBe(200);
    const callData = mockPrisma.product.update.mock.calls[0][0].data;
    expect(callData.flavor).toBeNull();
    expect(callData.supplier).toBeNull();
    expect(callData.usedIn).toBeNull();
  });

  it("rejects an empty purchaseUnit (required on the model)", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ purchaseUnit: "   " });

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("rejects an empty name (rename must not blank a product)", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "" });

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("renames a product via PATCH name", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Gushers 0.8oz 42pk (Costco)" });

    expect(res.status).toBe(200);
    const callData = mockPrisma.product.update.mock.calls[0][0].data;
    expect(callData.name).toBe("Gushers 0.8oz 42pk (Costco)");
    // Rename touches ONLY the product row — history joins by productId,
    // so no Removal/Receipt rows may be rewritten.
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } })
    );
  });

  it("silently drops unitSize and brandText (legacy columns, not editable via PATCH)", async () => {
    const res = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ unitSize: "999 lb", brandText: "Smuggled Brand", name: "Ok Name" });

    expect(res.status).toBe(200);
    const callData = mockPrisma.product.update.mock.calls[0][0].data;
    expect(callData).not.toHaveProperty("unitSize");
    expect(callData).not.toHaveProperty("brandText");
    expect(callData.name).toBe("Ok Name");
  });

  it("rejects null for required string fields (name/category/purchaseUnit)", async () => {
    for (const field of ["name", "category", "purchaseUnit"]) {
      const res = await request(app)
        .patch("/api/v1/products/1")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ [field]: null });
      expect(res.status).toBe(400);
    }
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("rejects over-long strings (201 chars) on both required and optional fields", async () => {
    const long = "x".repeat(201);
    for (const field of ["name", "supplier"]) {
      const res = await request(app)
        .patch("/api/v1/products/1")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ [field]: long });
      expect(res.status).toBe(400);
    }
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("deactivates with { active: false } and rejects non-boolean active", async () => {
    const ok = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });
    expect(ok.status).toBe(200);
    expect(mockPrisma.product.update.mock.calls[0][0].data.active).toBe(false);

    const bad = await request(app)
      .patch("/api/v1/products/1")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: "false" });
    expect(bad.status).toBe(400);
    expect(mockPrisma.product.update).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/v1/products — includeInactive", () => {
  beforeEach(() => {
    mockPrisma.product.findMany.mockResolvedValue([]);
  });

  it("filters to active products by default (admin)", async () => {
    const res = await request(app)
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: true }),
      })
    );
  });

  it("admin + includeInactive=true drops the active filter", async () => {
    const res = await request(app)
      .get("/api/v1/products?includeInactive=true")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const where = mockPrisma.product.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("active");
  });

  it("team token + includeInactive=true is silently ignored — floor never sees retired SKUs", async () => {
    const res = await request(app)
      .get("/api/v1/products?includeInactive=true")
      .set("Authorization", `Bearer ${teamToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: true }),
      })
    );
  });

  // Fail-closed pinning: only the exact string "true" may drop the filter.
  // These guard against a future refactor to loose equality/coercion —
  // e.g. ["true"] == "true" is TRUE in JS, which would let repeated params
  // leak inactive SKUs.
  it("case variants (?includeInactive=TRUE) keep the active filter for any token", async () => {
    for (const token of [adminToken, teamToken]) {
      mockPrisma.product.findMany.mockClear();
      const res = await request(app)
        .get("/api/v1/products?includeInactive=TRUE")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        })
      );
    }
  });

  it("repeated / bracketed params (arrays) fail closed for any token", async () => {
    for (const qs of [
      "includeInactive=true&includeInactive=true",
      "includeInactive[]=true",
    ]) {
      for (const token of [adminToken, teamToken]) {
        mockPrisma.product.findMany.mockClear();
        const res = await request(app)
          .get(`/api/v1/products?${qs}`)
          .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ active: true }),
          })
        );
      }
    }
  });
});

describe("GET /api/v1/products/:id — inactive products are admin-only", () => {
  const inactiveProduct = {
    id: 7,
    name: "Retired Gummy",
    category: "Gummy",
    purchaseUnit: "Bag",
    currentQty: 3,
    alertThreshold: 5,
    active: false,
    brand: null,
    brandId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns an inactive product to an admin token", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(inactiveProduct);
    const res = await request(app)
      .get("/api/v1/products/7")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
  });

  it("404s for a team token — the floor never sees retired SKUs, even by ID", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(inactiveProduct);
    const res = await request(app)
      .get("/api/v1/products/7")
      .set("Authorization", `Bearer ${teamToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("still returns active products to team tokens", async () => {
    mockPrisma.product.findUnique.mockResolvedValue({
      ...inactiveProduct,
      active: true,
    });
    const res = await request(app)
      .get("/api/v1/products/7")
      .set("Authorization", `Bearer ${teamToken}`);

    expect(res.status).toBe(200);
  });
});

describe("unitPrice validation — bad input must 400, never 500", () => {
  it("PATCH rejects non-numeric and negative unitPrice", async () => {
    for (const unitPrice of ["abc", -5]) {
      mockPrisma.product.update.mockClear();
      const res = await request(app)
        .patch("/api/v1/products/1")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ unitPrice });
      expect(res.status).toBe(400);
      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    }
  });

  it("POST rejects non-numeric and negative unitPrice", async () => {
    for (const unitPrice of ["abc", -5]) {
      mockPrisma.product.create.mockClear();
      const res = await asAdmin({
        name: "X",
        category: "Gummy",
        purchaseUnit: "Bag",
        unitPrice,
      });
      expect(res.status).toBe(400);
      expect(mockPrisma.product.create).not.toHaveBeenCalled();
    }
  });
});
