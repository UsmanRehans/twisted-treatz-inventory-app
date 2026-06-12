// ─── Low-stock alert rules ──────────────────────────────────────────
// Alert fires when qty drops AT OR BELOW threshold, at most once per
// product per day, and never throws into the removal flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import { checkAndSendAlert } from "../src/services/alertService.js";
import { prisma } from "../src/lib/prisma.js";
import type { MockPrisma } from "./helpers/mockPrisma.js";

const mockPrisma = prisma as unknown as MockPrisma;

const removalInfo = { memberName: "Jess", qty: 3 };

function productAt(currentQty: number, alertThreshold: number) {
  return {
    id: 1,
    name: "Candy Corn Bulk",
    category: "Candy Corn",
    currentQty,
    alertThreshold,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe("checkAndSendAlert", () => {
  it("does nothing while stock is above the threshold", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(11, 10));
    await checkAndSendAlert(1, removalInfo);
    expect(mockPrisma.alertLog.create).not.toHaveBeenCalled();
  });

  it("fires when stock lands exactly ON the threshold (at-or-below rule)", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(10, 10));
    mockPrisma.alertLog.findFirst.mockResolvedValue(null);
    await checkAndSendAlert(1, removalInfo);
    expect(mockPrisma.alertLog.create).toHaveBeenCalledWith({ data: { productId: 1 } });
  });

  it("fires when stock is below the threshold", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(2, 10));
    mockPrisma.alertLog.findFirst.mockResolvedValue(null);
    await checkAndSendAlert(1, removalInfo);
    expect(mockPrisma.alertLog.create).toHaveBeenCalled();
  });

  it("suppresses a second alert for the same product on the same day", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(2, 10));
    mockPrisma.alertLog.findFirst.mockResolvedValue({
      id: 99,
      productId: 1,
      sentAt: new Date(),
    });
    await checkAndSendAlert(1, removalInfo);
    expect(mockPrisma.alertLog.create).not.toHaveBeenCalled();
  });

  it("checks today's window when looking for prior alerts", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(2, 10));
    mockPrisma.alertLog.findFirst.mockResolvedValue(null);
    await checkAndSendAlert(1, removalInfo);

    const query = mockPrisma.alertLog.findFirst.mock.calls[0][0];
    expect(query.where.productId).toBe(1);
    expect(query.where.sentAt.gte).toBeInstanceOf(Date);
    expect(query.where.sentAt.lte).toBeInstanceOf(Date);
  });

  it("never throws, even when the database call fails", async () => {
    mockPrisma.product.findUnique.mockRejectedValue(new Error("db down"));
    await expect(checkAndSendAlert(1, removalInfo)).resolves.toBeUndefined();
  });
});
