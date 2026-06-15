// ─── Bulk CSV stock adjustments ─────────────────────────────────────
// Admin-only export/import. The import writes an Adjustment (the admin
// counterpart of Removal/Receipt) in the same transaction as the qty
// update, computes deltas against the LIVE qty (absolute new_qty in,
// signed delta recorded), and never blocks good rows on a bad one.

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

// Stock at apply time: id 7 = 4 on hand, id 8 = 100 on hand
const products = [
  { id: 7, name: "Sour Patch Bulk", currentQty: 4, alertThreshold: 10, active: true },
  { id: 8, name: "Gummy Bears Bulk", currentQty: 100, alertThreshold: 10, active: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  mockPrisma.product.findMany.mockResolvedValue(products);
  mockPrisma.product.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...data }),
  );
  mockPrisma.adjustment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 1, createdAt: new Date(), ...data }),
  );
});

function importRows(body: Record<string, unknown>, token = adminToken) {
  return request(app)
    .post("/api/v1/adjustments/import")
    .set(auth(token))
    .send(body);
}

// ─── Authorization ──────────────────────────────────────────────
describe("adjustments — authorization (admin only)", () => {
  it("GET /export rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/adjustments/export");
    expect(res.status).toBe(401);
  });

  it("GET /export rejects team member tokens", async () => {
    const res = await request(app).get("/api/v1/adjustments/export").set(auth(teamToken));
    expect(res.status).toBe(403);
  });

  it("POST /import rejects team member tokens", async () => {
    const res = await importRows({ rows: [{ id: 7, newQty: 5 }] }, teamToken);
    expect(res.status).toBe(403);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("POST /import rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/adjustments/import").send({ rows: [] });
    expect(res.status).toBe(401);
  });
});

// ─── Export CSV ─────────────────────────────────────────────────
describe("GET /api/v1/adjustments/export", () => {
  it("emits a BOM + header and one row per active product", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { id: 7, name: "Sour Patch Bulk", category: "Sour Candy", purchaseUnit: "Bag", unitSize: "5 lb", currentQty: 4 },
      { id: 8, name: "Gummy Bears Bulk", category: "Gummy", purchaseUnit: "Box", unitSize: null, currentQty: 100 },
    ]);
    const res = await request(app).get("/api/v1/adjustments/export").set(auth(adminToken));
    expect(res.status).toBe(200);
    const csv: string = res.body.data.csv;
    expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    expect(csv).toContain("id,name,category,purchase_unit,unit_size,current_qty,new_qty,note");
    expect(res.body.data.productCount).toBe(2);
  });

  it("neutralizes formula-injection cells (= + - @)", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 9,
        name: "=cmd|'/c calc'!A1",
        category: "Gummy",
        purchaseUnit: "Bag",
        unitSize: "5 lb",
        currentQty: 3,
      },
    ]);
    const res = await request(app).get("/api/v1/adjustments/export").set(auth(adminToken));
    const csv: string = res.body.data.csv;
    // The dangerous name is quoted and prefixed with a single quote
    expect(csv).toContain(`"'=cmd|'`);
    expect(csv).not.toContain(`,=cmd`);
  });
});

// ─── Import: absolute qty → signed delta, atomic per row ─────────
describe("POST /api/v1/adjustments/import — apply", () => {
  it("records the signed delta against LIVE qty and writes qty+Adjustment together", async () => {
    // id 7 live=4 → new 20 (delta +16); id 8 live=100 → new 90 (delta -10)
    const res = await importRows({
      rows: [
        { id: 7, newQty: 20, csvQty: 4 },
        { id: 8, newQty: 90, csvQty: 100 },
      ],
    });

    expect(res.status).toBe(201);
    // Each row is its own transaction (atomicity per row)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);

    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: { currentQty: 20 } }),
    );
    expect(mockPrisma.adjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ productId: 7, delta: 16, qtyBefore: 4, qtyAfter: 20 }) }),
    );
    expect(mockPrisma.adjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ productId: 8, delta: -10, qtyBefore: 100, qtyAfter: 90 }) }),
    );

    expect(res.body.data.summary).toMatchObject({ changes: 2, added: 16, removed: 10 });
    // All adjustments in one import share a batchId
    expect(res.body.data.batchId).toBeTruthy();
  });

  it("groups every applied row under one batchId", async () => {
    await importRows({ rows: [{ id: 7, newQty: 5 }, { id: 8, newQty: 50 }] });
    const batches = mockPrisma.adjustment.create.mock.calls.map(
      (c) => (c[0] as { data: { batchId: string } }).data.batchId,
    );
    expect(new Set(batches).size).toBe(1);
  });

  it("skips rows whose new_qty equals current qty (no-op)", async () => {
    const res = await importRows({ rows: [{ id: 7, newQty: 4 }] });
    expect(res.status).toBe(201);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(res.body.data.summary).toMatchObject({ changes: 0, unchanged: 1 });
  });

  it("flags conflict rows but still applies them (admin's count wins)", async () => {
    // CSV said 50 but live is 100 → floor moved stock mid-edit
    const res = await importRows({ rows: [{ id: 8, newQty: 90, csvQty: 50 }] });
    expect(res.status).toBe(201);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 }, data: { currentQty: 90 } }),
    );
    expect(res.body.data.applied[0].conflict).toBe(true);
    expect(res.body.data.summary.conflicts).toBe(1);
  });

  it("flags products that land at/below threshold without sending email", async () => {
    // id 7 threshold 10 → set to 2
    const res = await importRows({ rows: [{ id: 7, newQty: 2 }] });
    expect(res.body.data.applied[0].belowThreshold).toBe(true);
    expect(res.body.data.summary.belowThreshold).toBe(1);
  });
});

// ─── Import: validation & partial failure ───────────────────────
describe("POST /api/v1/adjustments/import — validation", () => {
  it("rejects an empty/missing rows array with 400", async () => {
    const res = await importRows({ rows: [] });
    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it.each([
    ["negative new_qty", { id: 7, newQty: -5 }],
    ["non-integer new_qty", { id: 7, newQty: 2.5 }],
    ["string new_qty", { id: 7, newQty: "20" }],
    ["bad id", { id: 0, newQty: 5 }],
  ])("skips %s and applies the rest (per-row report)", async (_label, badRow) => {
    const res = await importRows({ rows: [badRow, { id: 8, newQty: 90 }] });
    expect(res.status).toBe(201);
    // Good row still applied
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 } }),
    );
    expect(res.body.data.skipped.length).toBe(1);
    expect(res.body.data.summary.errors).toBe(1);
  });

  it("reports unknown / inactive product ids without applying them", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { id: 8, name: "Gummy Bears Bulk", currentQty: 100, alertThreshold: 10, active: true },
      { id: 7, name: "Inactive", currentQty: 4, alertThreshold: 10, active: false },
    ]);
    const res = await importRows({
      rows: [
        { id: 7, newQty: 20 }, // inactive
        { id: 999, newQty: 5 }, // unknown
        { id: 8, newQty: 90 }, // good
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.summary.changes).toBe(1);
    expect(res.body.data.skipped).toHaveLength(2);
  });

  it("collapses duplicate rows for the same product", async () => {
    const res = await importRows({ rows: [{ id: 7, newQty: 20 }, { id: 7, newQty: 30 }] });
    const skips = res.body.data.skipped as { reason: string }[];
    expect(skips.some((s) => s.reason.includes("duplicate"))).toBe(true);
  });
});

// ─── Unified activity feed ──────────────────────────────────────
describe("GET /api/v1/admin/activity (unified feed)", () => {
  beforeEach(() => {
    mockPrisma.removal.findMany.mockResolvedValue([
      {
        id: 1,
        productId: 7,
        qty: 3,
        qtyAfter: 1,
        createdAt: new Date("2026-06-14T10:00:00Z"),
        product: { name: "Sour Patch", category: "Sour Candy" },
        teamMember: { name: "Jess" },
      },
    ]);
    mockPrisma.receipt.findMany.mockResolvedValue([
      {
        id: 1,
        productId: 8,
        actualQty: 50,
        notes: "Sam's run",
        createdAt: new Date("2026-06-14T12:00:00Z"),
        product: { name: "Gummy Bears", category: "Gummy" },
        admin: { name: "Usman" },
      },
    ]);
    mockPrisma.adjustment.findMany.mockResolvedValue([
      {
        id: 1,
        productId: 7,
        delta: -5,
        qtyAfter: 2,
        reason: "cycle count",
        createdAt: new Date("2026-06-14T14:00:00Z"),
        product: { name: "Sour Patch", category: "Sour Candy" },
        admin: { name: "Usman" },
      },
    ]);
    mockPrisma.removal.count.mockResolvedValue(1);
    mockPrisma.receipt.count.mockResolvedValue(1);
    mockPrisma.adjustment.count.mockResolvedValue(1);
  });

  it("rejects team member tokens (admin only)", async () => {
    const res = await request(app).get("/api/v1/admin/activity").set(auth(teamToken));
    expect(res.status).toBe(403);
  });

  it("merges all three movement types newest-first with signed deltas", async () => {
    const res = await request(app).get("/api/v1/admin/activity").set(auth(adminToken));
    expect(res.status).toBe(200);
    const events = res.body.data.events as { type: string; delta: number }[];
    expect(events.map((e) => e.type)).toEqual(["adjustment", "receipt", "removal"]);
    // Removals are negative, receipts positive, adjustment carries its sign
    expect(events.find((e) => e.type === "removal")!.delta).toBe(-3);
    expect(events.find((e) => e.type === "receipt")!.delta).toBe(50);
    expect(events.find((e) => e.type === "adjustment")!.delta).toBe(-5);
    expect(res.body.data.total).toBe(3);
  });

  it("returns only removals when a member filter is set", async () => {
    const res = await request(app)
      .get("/api/v1/admin/activity?memberId=2")
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(mockPrisma.receipt.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.adjustment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.removal.findMany).toHaveBeenCalled();
  });

  it("queries only adjustments when type=adjustment", async () => {
    const res = await request(app)
      .get("/api/v1/admin/activity?type=adjustment")
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(mockPrisma.removal.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.receipt.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.adjustment.findMany).toHaveBeenCalled();
  });

  it("never leaks pinHash/passwordHash in the feed payload", async () => {
    const res = await request(app).get("/api/v1/admin/activity").set(auth(adminToken));
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("pinHash");
    expect(body).not.toContain("passwordHash");
    // Guard against a future `include: { admin: true }` regression: every
    // relation must be fetched with a scoped object (select), never `true`,
    // which would pull the full record incl. passwordHash/pinHash.
    for (const fn of [mockPrisma.removal.findMany, mockPrisma.receipt.findMany, mockPrisma.adjustment.findMany]) {
      for (const call of fn.mock.calls) {
        const include = (call[0] as { include?: Record<string, unknown> }).include ?? {};
        for (const relation of Object.values(include)) {
          expect(typeof relation).toBe("object");
        }
      }
    }
  });
});

// ─── Dry run ────────────────────────────────────────────────────
describe("POST /api/v1/adjustments/import — dry run", () => {
  it("computes the same summary but writes nothing", async () => {
    const res = await importRows({
      rows: [{ id: 7, newQty: 20 }, { id: 8, newQty: 90 }],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.batchId).toBeNull();
    expect(res.body.data.summary.changes).toBe(2);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.adjustment.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
