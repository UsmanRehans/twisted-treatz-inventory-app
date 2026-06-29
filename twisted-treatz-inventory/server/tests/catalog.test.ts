// ─── Catalog import ─────────────────────────────────────────────────
// Ingests Hani's master sheet (Item, Category, Qty, Pack Size, UOM, Brand).
// Matches existing products BY NAME, creates missing ones at qty 0 (then an
// Adjustment moves 0→count so stock never appears without an audit row),
// and updates catalog fields on matches. Empty cells follow the agreed
// rule: blank Qty → 0 and FLAGGED for Hani; blank Brand/Pack/UOM stay null
// and are flagged — never silently invented or overwritten.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({ default: { setApiKey: vi.fn(), send: vi.fn() } }));

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
function importCatalog(body: Record<string, unknown>, token = adminToken) {
  return request(app).post("/api/v1/catalog/import").set(auth(token)).send(body);
}

// Existing catalog: one Gummy with brand 5, pack 30 lb, 7 on hand.
const existingProducts = [
  {
    id: 7,
    name: "Fruit Slices Assorted",
    category: "Gummy",
    brandId: 5,
    packSize: 30,
    uom: "lb",
    currentQty: 7,
  },
];

let createdId = 1000;
beforeEach(() => {
  vi.clearAllMocks();
  createdId = 1000;
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  mockPrisma.product.findMany.mockResolvedValue(existingProducts);
  mockPrisma.brand.findMany.mockResolvedValue([{ id: 5, name: "Boston" }]);
  mockPrisma.product.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: ++createdId, ...data }),
  );
  mockPrisma.product.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...data }),
  );
  mockPrisma.brand.upsert.mockImplementation(({ create }: { create: { name: string } }) =>
    Promise.resolve({ id: 900, name: create.name }),
  );
  mockPrisma.adjustment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 1, createdAt: new Date(), ...data }),
  );
});

// ─── Authorization ──────────────────────────────────────────────
describe("catalog import — authorization (admin only)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/catalog/import").send({ rows: [] });
    expect(res.status).toBe(401);
  });
  it("rejects team member tokens", async () => {
    const res = await importCatalog({ rows: [{ item: "X", qty: 1 }] }, teamToken);
    expect(res.status).toBe(403);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });
});

// ─── Dry run classification ─────────────────────────────────────
describe("catalog import — dry run", () => {
  it("classifies create vs update and writes nothing", async () => {
    const res = await importCatalog({
      dryRun: true,
      rows: [
        { item: "Fruit Slices Assorted", category: "Gummy", brand: "Boston", packSize: 30, uom: "lb", qty: 10 },
        { item: "Brand New Candy", category: "Hard Candy", brand: "Boston", packSize: 20, uom: "lb", qty: 4 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.batchId).toBeNull();
    expect(res.body.data.summary.creates).toBe(1);
    expect(res.body.data.summary.updates).toBe(1);
    // qty 7→10 on the existing match
    expect(res.body.data.updates[0]).toMatchObject({ id: 7, qtyBefore: 7, qtyAfter: 10, qtyDelta: 3 });
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.adjustment.create).not.toHaveBeenCalled();
  });

  it("matches existing products case-insensitively by name", async () => {
    const res = await importCatalog({
      dryRun: true,
      rows: [{ item: "  fruit slices ASSORTED ", qty: 7 }],
    });
    // qty unchanged (7→7) and no field changes → unchanged, not a create
    expect(res.body.data.summary.creates).toBe(0);
    expect(res.body.data.summary.updates).toBe(0);
    expect(res.body.data.unchanged).toBe(1);
  });
});

// ─── Apply: new product born at 0, then Adjustment ──────────────
describe("catalog import — apply (creates)", () => {
  it("creates a new product at qty 0 then writes an Adjustment 0→count", async () => {
    const res = await importCatalog({
      rows: [{ item: "Brand New Candy", category: "Hard Candy", brand: "Boston", packSize: 20, uom: "lb", qty: 4 }],
    });
    expect(res.status).toBe(201);
    // Born empty — currentQty hard 0 at create, never from the sheet
    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Brand New Candy", currentQty: 0, packSize: 20, uom: "lb", brandId: 5 }) }),
    );
    // The count arrives as an audited Adjustment, paired in a transaction
    expect(mockPrisma.adjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ delta: 4, qtyBefore: 0, qtyAfter: 4 }) }),
    );
    expect(res.body.data.batchId).toBeTruthy();
  });

  it("creates a brand that doesn't exist yet and links it", async () => {
    await importCatalog({
      rows: [{ item: "New Thing", category: "Gummy", brand: "Albanese", packSize: 20, uom: "lb", qty: 1 }],
    });
    expect(mockPrisma.brand.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Albanese" }, create: { name: "Albanese" } }),
    );
    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brandId: 900 }) }),
    );
  });

  it("creates a product with no Adjustment when counted qty is 0", async () => {
    const res = await importCatalog({
      rows: [{ item: "Empty Count Item", category: "Gummy", brand: "Boston", packSize: 20, uom: "lb" }],
    });
    expect(mockPrisma.product.create).toHaveBeenCalled();
    expect(mockPrisma.adjustment.create).not.toHaveBeenCalled(); // qty 0 → no stock movement
    expect(res.body.data.summary.zeroed).toBe(1);
  });
});

// ─── Apply: updates ─────────────────────────────────────────────
describe("catalog import — apply (updates)", () => {
  it("updates only changed catalog fields with no Adjustment when qty is unchanged", async () => {
    // same qty (7) but uom lb→ct and pack 30→26.4
    const res = await importCatalog({
      rows: [{ item: "Fruit Slices Assorted", brand: "Boston", packSize: 26.4, uom: "ct", qty: 7 }],
    });
    expect(res.status).toBe(201);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: expect.objectContaining({ packSize: 26.4, uom: "ct" }) }),
    );
    // Catalog-only change → no stock movement
    expect(mockPrisma.adjustment.create).not.toHaveBeenCalled();
    expect(res.body.data.summary.qtyChanges).toBe(0);
  });

  it("pairs a qty change with an Adjustment in one transaction", async () => {
    const res = await importCatalog({
      rows: [{ item: "Fruit Slices Assorted", brand: "Boston", packSize: 30, uom: "lb", qty: 12 }],
    });
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: expect.objectContaining({ currentQty: 12 }) }),
    );
    expect(mockPrisma.adjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ productId: 7, delta: 5, qtyBefore: 7, qtyAfter: 12 }) }),
    );
    expect(res.body.data.summary.qtyChanges).toBe(1);
  });
});

// ─── Per-row apply failures don't abort the batch (QA-1) ────────
describe("catalog import — partial apply failure", () => {
  it("reports a create that fails to save and still applies the rest", async () => {
    mockPrisma.product.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      if (data.name === "Bad Save") return Promise.reject(new Error("db boom"));
      return Promise.resolve({ id: ++createdId, ...data });
    });
    const res = await importCatalog({
      rows: [
        { item: "Bad Save", category: "Gummy", brand: "Boston", packSize: 1, uom: "lb", qty: 1 },
        { item: "Good Save", category: "Gummy", brand: "Boston", packSize: 1, uom: "lb", qty: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const failures = res.body.data.applyFailures as { item: string; reason: string }[];
    expect(failures).toHaveLength(1);
    expect(failures[0].item).toBe("Bad Save");
    expect(res.body.data.summary.failed).toBe(1);
    // The good row still created (create called for both)
    expect(mockPrisma.product.create).toHaveBeenCalledTimes(2);
  });

  it("reports an update whose transaction fails without 500ing", async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(new Error("db boom"));
    const res = await importCatalog({
      rows: [{ item: "Fruit Slices Assorted", brand: "Boston", packSize: 30, uom: "lb", qty: 99 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.summary.failed).toBe(1);
    expect(res.body.data.applyFailures[0].item).toBe("Fruit Slices Assorted");
  });
});

// ─── Empty-cell rule: blank Qty → 0 + flag; blank others → flag ──
describe("catalog import — empty cells", () => {
  it("flags a blank Qty, treats it as 0, and counts the zeroing", async () => {
    const res = await importCatalog({
      dryRun: true,
      rows: [{ item: "Fruit Slices Assorted", brand: "Boston", packSize: 30, uom: "lb" }], // no qty
    });
    const flagged = res.body.data.flagged as { item: string; missing: string[] }[];
    expect(flagged[0].missing).toContain("qty");
    // existing 7 → 0
    expect(res.body.data.updates[0]).toMatchObject({ qtyAfter: 0, qtyDelta: -7 });
    expect(res.body.data.summary.zeroed).toBe(1);
  });

  it("flags blank Brand / Pack Size / UOM and does not overwrite existing values", async () => {
    const res = await importCatalog({
      dryRun: true,
      rows: [{ item: "Fruit Slices Assorted", qty: 7 }], // only item + qty
    });
    const flagged = res.body.data.flagged as { item: string; missing: string[] }[];
    expect(flagged[0].missing).toEqual(expect.arrayContaining(["brand", "packSize", "uom"]));
    // No catalog changes proposed — blanks never clobber existing data
    expect(res.body.data.summary.updates).toBe(0);
    expect(res.body.data.unchanged).toBe(1);
  });
});

// ─── Validation & partial failure ───────────────────────────────
describe("catalog import — validation", () => {
  it("rejects an empty rows array with 400", async () => {
    const res = await importCatalog({ rows: [] });
    expect(res.status).toBe(400);
  });

  it("skips rows with a missing item name and applies the rest", async () => {
    const res = await importCatalog({
      rows: [
        { item: "", qty: 5 },
        { item: "Good New One", category: "Gummy", brand: "Boston", packSize: 20, uom: "lb", qty: 3 },
      ],
    });
    expect(res.status).toBe(201);
    const skipped = res.body.data.skipped as { reason: string }[];
    expect(skipped.some((s) => s.reason.includes("required"))).toBe(true);
    expect(res.body.data.summary.creates).toBe(1);
  });

  it("collapses duplicate items in the file (case-insensitive)", async () => {
    const res = await importCatalog({
      dryRun: true,
      rows: [
        { item: "Dup Candy", qty: 1, brand: "Boston", packSize: 1, uom: "lb" },
        { item: "dup candy", qty: 2, brand: "Boston", packSize: 1, uom: "lb" },
      ],
    });
    const skipped = res.body.data.skipped as { reason: string }[];
    expect(skipped.some((s) => s.reason.includes("duplicate"))).toBe(true);
  });

  it("skips a row with a non-numeric pack size but keeps good rows", async () => {
    const res = await importCatalog({
      rows: [
        { item: "Bad Pack", category: "Gummy", brand: "Boston", packSize: "thirty", uom: "lb", qty: 1 },
        { item: "Good Pack", category: "Gummy", brand: "Boston", packSize: 30, uom: "lb", qty: 1 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.summary.errors).toBe(1);
    expect(res.body.data.summary.creates).toBe(1);
  });

  it("never leaks pinHash/passwordHash", async () => {
    const res = await importCatalog({ dryRun: true, rows: [{ item: "X", qty: 1 }] });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("pinHash");
    expect(body).not.toContain("passwordHash");
  });
});
