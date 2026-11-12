// ─── Product grouping round-trip ─────────────────────────────────────
// The Grouping sheet import is the ONLY writer of groupId/variant, and the
// only place an import may deactivate a product. These tests pin the rules:
// dry run writes nothing, blank group = stands alone, variation without a
// group never half-applies, deactivation is one-way and never touches stock,
// and empty groups are swept after reassignment.

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

const adminToken = generateAdminToken({
  id: 1,
  email: "usman@twistedtreatz.com",
  tokenVersion: 0,
});
const teamToken = generateTeamMemberToken({ id: 2, name: "Jess", initials: "JR" });

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Current DB state used across tests: two grouped flavors, one loner with
// stock, one already-inactive product.
function seedProducts() {
  mockPrisma.product.findMany.mockResolvedValue([
    {
      id: 10,
      name: "Fruit Jelly Cherry",
      category: "Gummy",
      active: true,
      currentQty: 46,
      variant: "Cherry",
      group: { id: 1, name: "Fruit Jelly" },
    },
    {
      id: 11,
      name: "Fruit Jelly Orange",
      category: "Gummy",
      active: true,
      currentQty: 30,
      variant: "Orange",
      group: { id: 1, name: "Fruit Jelly" },
    },
    {
      id: 12,
      name: "Glucose Syrup",
      category: "Raw material",
      active: true,
      currentQty: 14,
      variant: null,
      group: null,
    },
    {
      id: 13,
      name: "Retired Taffy",
      category: "Chews",
      active: false,
      currentQty: 0,
      variant: null,
      group: null,
    },
  ]);
  mockPrisma.productGroup.findMany.mockResolvedValue([
    { id: 1, name: "Fruit Jelly", variantLabel: "Flavor" },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.product.update.mockResolvedValue({});
  mockPrisma.productGroup.upsert.mockImplementation(
    async (args: { create: { name: string; variantLabel?: string } }) => ({
      id: 99,
      name: args.create.name,
      variantLabel: args.create.variantLabel ?? "Flavor",
    }),
  );
  mockPrisma.productGroup.update.mockResolvedValue({});
  mockPrisma.productGroup.deleteMany.mockResolvedValue({ count: 0 });
  seedProducts();
});

// ─── Auth surface ────────────────────────────────────────────────────

describe("groups auth", () => {
  it("export rejects unauthenticated and team tokens", async () => {
    expect((await request(app).get("/api/v1/groups/export")).status).toBe(401);
    expect(
      (await request(app).get("/api/v1/groups/export").set(auth(teamToken))).status,
    ).toBe(403);
  });

  it("import rejects unauthenticated and team tokens", async () => {
    const body = { rows: [{ id: 10 }], dryRun: true };
    expect((await request(app).post("/api/v1/groups/import").send(body)).status).toBe(401);
    expect(
      (await request(app).post("/api/v1/groups/import").set(auth(teamToken)).send(body)).status,
    ).toBe(403);
  });
});

// ─── Export ──────────────────────────────────────────────────────────

describe("GET /api/v1/groups/export", () => {
  it("emits the grouping columns with current group/variation", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 10,
        name: "Fruit Jelly Cherry",
        category: "Gummy",
        variant: "Cherry",
        group: { name: "Fruit Jelly" },
        brand: { name: "Jovy" },
        packSize: 30,
        uom: "lb",
        currentQty: 46,
      },
    ]);
    const res = await request(app).get("/api/v1/groups/export").set(auth(adminToken));
    expect(res.status).toBe(200);
    const csv = res.body.data.csv as string;
    expect(csv).toContain(
      "ID,Product name,Group,Variation,Discontinued? (X),Category,Brand,Pack size,Qty on hand",
    );
    expect(csv).toContain('10,"Fruit Jelly Cherry","Fruit Jelly","Cherry",');
    // only active products are asked for
    expect(mockPrisma.product.findMany.mock.calls[0][0].where).toEqual({ active: true });
  });

  it("neutralizes formula-injection in product and group names", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 7,
        name: "=HYPERLINK(evil)",
        category: "Gummy",
        variant: "+SUM(A1)",
        group: { name: "@cmd" },
        brand: null,
        packSize: null,
        uom: null,
        currentQty: 0,
      },
    ]);
    const res = await request(app).get("/api/v1/groups/export").set(auth(adminToken));
    const csv = res.body.data.csv as string;
    expect(csv).toContain("\"'=HYPERLINK(evil)\"");
    expect(csv).toContain("\"'+SUM(A1)\"");
    expect(csv).toContain("\"'@cmd\"");
  });
});

// ─── Import: validation and dry run ──────────────────────────────────

describe("POST /api/v1/groups/import (dry run)", () => {
  it("rejects a missing or empty rows array", async () => {
    const res = await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({ dryRun: true });
    expect(res.status).toBe(400);
  });

  it("plans grouping, ungrouping and new groups without writing", async () => {
    const res = await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({
        dryRun: true,
        rows: [
          { id: 10, group: "Fruit Jelly", variation: "Cherry" }, // unchanged
          { id: 11, group: "", variation: "" }, // leaves its group
          { id: 12, group: "Syrups", variation: "Glucose" }, // joins a NEW group
        ],
      });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.dryRun).toBe(true);
    expect(d.unchanged).toBe(1);
    expect(d.newGroups).toEqual(["Syrups"]);
    expect(d.summary.grouped).toBe(1);
    expect(d.summary.ungrouped).toBe(1);
    // dry run must not touch the database
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.productGroup.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.productGroup.deleteMany).not.toHaveBeenCalled();
  });

  it("skips unknown IDs, duplicate IDs and variation-without-group", async () => {
    const res = await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({
        dryRun: true,
        rows: [
          { id: 999, group: "Ghost" },
          { id: 10, group: "Fruit Jelly", variation: "Cherry" },
          { id: 10, group: "Fruit Jelly", variation: "Cherry" }, // dup
          { id: 12, variation: "Orphan" }, // variation without group
        ],
      });
    const d = res.body.data;
    const reasons = d.skipped.map((s: { reason: string }) => s.reason);
    expect(reasons).toContain("no product with this ID");
    expect(reasons).toContain("duplicate ID in file");
    expect(reasons).toContain("variation given without a group");
  });

  it("lists deactivations with stock on hand and treats blank as never-reactivate", async () => {
    const res = await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({
        dryRun: true,
        rows: [
          { id: 12, discontinued: "X" }, // active, 14 on hand → flagged
          { id: 13, discontinued: "" }, // inactive + blank → stays inactive, unchanged
        ],
      });
    const d = res.body.data;
    expect(d.deactivations).toEqual([{ id: 12, item: "Glucose Syrup", qtyOnHand: 14 }]);
    expect(d.summary.deactivationsWithStock).toBe(1);
    expect(d.unchanged).toBe(1);
  });

  it("plans category changes from the Groups-tab metadata", async () => {
    const res = await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({
        dryRun: true,
        rows: [{ id: 11, group: "Fruit Jelly", variation: "Orange" }],
        groups: [{ group: "Fruit Jelly", category: "Jelly", variantLabel: "Flavor" }],
      });
    const d = res.body.data;
    expect(d.categoryChanges).toEqual([
      { id: 11, item: "Fruit Jelly Orange", from: "Gummy", to: "Jelly" },
    ]);
  });
});

// ─── Import: apply ───────────────────────────────────────────────────

describe("POST /api/v1/groups/import (apply)", () => {
  it("creates new groups, moves products and sweeps empty groups afterwards", async () => {
    const res = await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({
        rows: [{ id: 12, group: "Syrups", variation: "Glucose" }],
        groups: [{ group: "Syrups", variantLabel: "Type" }],
      });
    expect(res.status).toBe(201);

    expect(mockPrisma.productGroup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: "Syrups" },
        create: { name: "Syrups", variantLabel: "Type" },
      }),
    );
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 12 },
        data: expect.objectContaining({ groupId: 99, variant: "Glucose" }),
      }),
    );
    // empty-group sweep runs after reassignment
    expect(mockPrisma.productGroup.deleteMany).toHaveBeenCalledWith({
      where: { products: { none: {} } },
    });
    const updateOrder = mockPrisma.product.update.mock.invocationCallOrder[0];
    const sweepOrder = mockPrisma.productGroup.deleteMany.mock.invocationCallOrder[0];
    expect(sweepOrder).toBeGreaterThan(updateOrder);
  });

  it("clears group and variant when the group cell is blank", async () => {
    await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({ rows: [{ id: 11, group: "", variation: "Orange" }] });
    // variation without group is skipped, so send truly blank variation
    await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({ rows: [{ id: 11, group: "", variation: "" }] });
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({ groupId: null, variant: null }),
      }),
    );
  });

  it("deactivates on X without touching stock or writing movement rows", async () => {
    await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({ rows: [{ id: 12, discontinued: "x" }] });

    expect(mockPrisma.product.update).toHaveBeenCalledTimes(1);
    const { data } = mockPrisma.product.update.mock.calls[0][0];
    expect(data.active).toBe(false);
    expect(data).not.toHaveProperty("currentQty");
    // deactivation is a catalog act: no audit-trail movement rows
    expect(mockPrisma.adjustment.create).not.toHaveBeenCalled();
    expect(mockPrisma.removal.create).not.toHaveBeenCalled();
    expect(mockPrisma.receipt.create).not.toHaveBeenCalled();
  });

  it("never reactivates from a blank discontinued cell", async () => {
    const res = await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({ rows: [{ id: 13, group: "", variation: "", discontinued: "" }] });
    expect(res.status).toBe(201);
    // row 13 is inactive and ungrouped → nothing to do, no update at all
    expect(res.body.data.unchanged).toBe(1);
    for (const call of mockPrisma.product.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("active", true);
    }
  });

  it("applies the group category to its products", async () => {
    await request(app)
      .post("/api/v1/groups/import")
      .set(auth(adminToken))
      .send({
        rows: [{ id: 11, group: "Fruit Jelly", variation: "Orange" }],
        groups: [{ group: "Fruit Jelly", category: "Jelly" }],
      });
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({ category: "Jelly" }),
      }),
    );
  });
});
