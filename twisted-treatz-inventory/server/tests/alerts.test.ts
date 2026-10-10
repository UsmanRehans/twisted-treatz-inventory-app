// ─── Low-stock alert rules ──────────────────────────────────────────
// Alert fires when qty drops AT OR BELOW threshold, at most once per
// product per day, and never throws into the removal flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

// alertService reads the SendGrid config at module load and silently skips
// sending when it is missing — stub the env before any import runs so the
// email assertions below exercise the real send path.
vi.hoisted(() => {
  process.env.SENDGRID_API_KEY = "test-sendgrid-key";
  process.env.ALERT_FROM_EMAIL = "alerts@twistedtreatz.com";
  process.env.ALERT_TO_EMAIL = "owner@twistedtreatz.com";
});

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import sgMail from "@sendgrid/mail";
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

  it("emails ALERT_TO_EMAIL from ALERT_FROM_EMAIL via SendGrid, naming the product", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(2, 10));
    mockPrisma.alertLog.findFirst.mockResolvedValue(null);
    await checkAndSendAlert(1, removalInfo);

    expect(sgMail.send).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(sgMail.send).mock.calls[0][0] as {
      to: string;
      from: string;
      subject: string;
      html: string;
    };
    expect(msg.to).toBe("owner@twistedtreatz.com");
    expect(msg.from).toBe("alerts@twistedtreatz.com");
    expect(msg.subject).toContain("Candy Corn Bulk");
    expect(msg.html).toContain("Candy Corn Bulk");
  });

  it("sends no email while stock is above the threshold", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(11, 10));
    await checkAndSendAlert(1, removalInfo);
    expect(sgMail.send).not.toHaveBeenCalled();
  });

  it("sends no second email for the same product on the same day", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(productAt(2, 10));
    mockPrisma.alertLog.findFirst.mockResolvedValue({ id: 99, productId: 1, sentAt: new Date() });
    await checkAndSendAlert(1, removalInfo);
    expect(sgMail.send).not.toHaveBeenCalled();
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

  it("checks today's Chicago calendar-day window when looking for prior alerts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T03:00:00.000Z")); // 22:00 CDT on Oct 9
    try {
      mockPrisma.product.findUnique.mockResolvedValue(productAt(2, 10));
      mockPrisma.alertLog.findFirst.mockResolvedValue(null);
      await checkAndSendAlert(1, removalInfo);

      const query = mockPrisma.alertLog.findFirst.mock.calls[0][0];
      expect(query.where.productId).toBe(1);
      // Still Oct 9 in Chicago even though UTC has rolled over to Oct 10
      expect(query.where.sentAt.gte.toISOString()).toBe("2026-10-09T05:00:00.000Z");
      expect(query.where.sentAt.lte.toISOString()).toBe("2026-10-10T04:59:59.999Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws, even when the database call fails", async () => {
    mockPrisma.product.findUnique.mockRejectedValue(new Error("db down"));
    await expect(checkAndSendAlert(1, removalInfo)).resolves.toBeUndefined();
  });
});
