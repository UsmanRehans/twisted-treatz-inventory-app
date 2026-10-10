// ─── Low-stock alerts with NO SendGrid configuration ─────────────────
// Production ran for months with empty SendGrid variables while the service
// kept logging "alert sent" and writing AlertLog rows. With mail disabled
// the service must send nothing AND record nothing, so the next removal
// tries again once mail is configured.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.hoisted(() => {
  delete process.env.SENDGRID_API_KEY;
  delete process.env.ALERT_FROM_EMAIL;
  delete process.env.ALERT_TO_EMAIL;
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
const lowProduct = { id: 1, name: "Candy Corn Bulk", category: "Candy Corn", currentQty: 2, alertThreshold: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.product.findUnique.mockResolvedValue(lowProduct);
  mockPrisma.alertLog.findFirst.mockResolvedValue(null);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe("checkAndSendAlert without SendGrid configured", () => {
  it("sends nothing and writes no AlertLog row", async () => {
    await checkAndSendAlert(1, { memberName: "Jess", qty: 3 });
    expect(sgMail.send).not.toHaveBeenCalled();
    expect(mockPrisma.alertLog.create).not.toHaveBeenCalled();
  });

  it("still never throws into the removal flow", async () => {
    await expect(checkAndSendAlert(1, { memberName: "Jess", qty: 3 })).resolves.toBeUndefined();
  });
});
