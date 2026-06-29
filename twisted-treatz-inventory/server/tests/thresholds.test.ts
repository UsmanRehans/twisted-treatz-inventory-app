// ─── Bulk CSV alert-threshold maintenance ───────────────────────────
// Admin-only export/import of each product's low-stock alertThreshold.
// Thresholds are config, not stock: import is a plain field update with NO
// Adjustment/audit row and NO alert emails. Products whose live qty now sits
// at/below the new threshold are flagged (belowThreshold), not emailed.

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
const adminToken = generateAdminToken({ id: 1, email: "usman@twistedtreatz.com", tokenVersion: 0 });
const teamToken = generateTeamMemberToken({ id: 2, name: "Jess", initials: "JR" });

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// id 7: 4 on hand, threshold 10; id 8: 100 on hand, threshold 10
const products = [
  { id: 7, name: "Sour Patch Bulk", currentQty: 4, alertThreshold: 10, active: true },
  { id: 8, name: "Gummy Bears Bulk", currentQty: 100, alertThreshold: 10, active: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.admin.findUnique.mockResolvedValue({ id: 1, tokenVersion: 0 });
  mockPrisma.product.findMany.mockResolvedValue(products);
  mockPrisma.product.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...data }),
  );
});

function importRows(body: Record<string, unknown>, token = adminToken) {
  return request(app).post("/api/v1/thresholds/import").set(auth(token)).send(body);
}

// ─── Authorization ──────────────────────────────────────────────
describe("thresholds — authorization (admin only)", () => {
  it("GET /export rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/thresholds/export");
    expect(res.status).toBe(401);
  });

  it("GET /export rejects team member tokens", async () => {
    const res = await request(app).get("/api/v1/thresholds/export").set(auth(teamToken));
    expect(res.status).toBe(403);
  });

  it("POST /import rejects team member tokens", async () => {
    const res = await importRows({ rows: [{ id: 7, newThreshold: 5 }] }, teamToken);
    expect(res.status).toBe(403);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("POST /import rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/thresholds/import").send({ rows: [] });
    expect(res.status).toBe(401);
  });
});

// ─── Export CSV ─────────────────────────────────────────────────
describe("GET /api/v1/thresholds/export", () => {
  it("emits a BOM + header and one row per active product", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { id: 7, name: "Sour Patch Bulk", category: "Sour Candy", currentQty: 4, alertThreshold: 10 },
      { id: 8, name: "Gummy Bears Bulk", category: "Gummy", currentQty: 100, alertThreshold: 25 },
    ]);
    const res = await request(app).get("/api/v1/thresholds/export").set(auth(adminToken));
    expect(res.status).toBe(200);
    const csv: string = res.body.data.csv;
    expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    expect(csv).toContain("id,item,category,current_qty,alert_threshold,new_threshold");
    // Current threshold is shown; new_threshold trails empty for the admin to fill.
    expect(csv).toContain(`7,"Sour Patch Bulk","Sour Candy",4,10,`);
    expect(res.body.data.productCount).toBe(2);
  });

  it("neutralizes formula-injection cells (= + - @)", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { id: 9, name: "=cmd|'/c calc'!A1", category: "Gummy", currentQty: 3, alertThreshold: 5 },
    ]);
    const res = await request(app).get("/api/v1/thresholds/export").set(auth(adminToken));
    const csv: string = res.body.data.csv;
    expect(csv).toContain(`"'=cmd|'`);
    expect(csv).not.toContain(`,=cmd`);
  });
});

// ─── Import: apply ──────────────────────────────────────────────
describe("POST /api/v1/thresholds/import — apply", () => {
  it("updates alertThreshold without writing any audit row", async () => {
    const res = await importRows({ rows: [{ id: 7, newThreshold: 20 }, { id: 8, newThreshold: 50 }] });
    expect(res.status).toBe(201);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: { alertThreshold: 20 } }),
    );
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 }, data: { alertThreshold: 50 } }),
    );
    // Thresholds are config, not stock — no Adjustment is ever written.
    expect(mockPrisma.adjustment?.create).not.toHaveBeenCalled();
    expect(res.body.data.summary).toMatchObject({ changes: 2, raised: 2, lowered: 0 });
  });

  it("counts raised vs lowered relative to the live threshold", async () => {
    // id 7 threshold 10 → 3 (lowered); id 8 threshold 10 → 40 (raised)
    const res = await importRows({ rows: [{ id: 7, newThreshold: 3 }, { id: 8, newThreshold: 40 }] });
    expect(res.body.data.summary).toMatchObject({ changes: 2, raised: 1, lowered: 1 });
  });

  it("skips rows whose threshold equals the current value (no-op)", async () => {
    const res = await importRows({ rows: [{ id: 7, newThreshold: 10 }] });
    expect(res.status).toBe(201);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(res.body.data.summary).toMatchObject({ changes: 0, unchanged: 1 });
  });

  it("flags products that now sit at/below the new threshold (no email)", async () => {
    // id 8 has 100 on hand → raise threshold to 100 means qty <= threshold
    const res = await importRows({ rows: [{ id: 8, newThreshold: 100 }] });
    expect(res.body.data.applied[0].belowThreshold).toBe(true);
    expect(res.body.data.summary.belowThreshold).toBe(1);
  });

  it("dry run classifies but writes nothing", async () => {
    const res = await importRows({ dryRun: true, rows: [{ id: 7, newThreshold: 99 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(res.body.data.summary.changes).toBe(1);
  });
});

// ─── Import: validation & partial failure ───────────────────────
describe("POST /api/v1/thresholds/import — validation", () => {
  it("skips a bad threshold but still applies the good rows", async () => {
    const res = await importRows({
      rows: [
        { id: 7, newThreshold: -5 }, // invalid
        { id: 8, newThreshold: 30 }, // valid
      ],
    });
    expect(res.status).toBe(201);
    expect(mockPrisma.product.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 }, data: { alertThreshold: 30 } }),
    );
    expect(res.body.data.summary).toMatchObject({ changes: 1, errors: 1 });
  });

  it("rejects non-integer / out-of-range thresholds", async () => {
    const res = await importRows({
      rows: [
        { id: 7, newThreshold: 5.5 },
        { id: 8, newThreshold: 2_000_000 },
      ],
    });
    expect(res.body.data.summary).toMatchObject({ changes: 0, errors: 2 });
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("skips a not-found / inactive product id", async () => {
    const res = await importRows({ rows: [{ id: 999, newThreshold: 5 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.skipped[0]).toMatchObject({ id: 999, reason: "Product not found or inactive" });
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  it("rejects an empty rows array", async () => {
    const res = await importRows({ rows: [] });
    expect(res.status).toBe(400);
  });
});
