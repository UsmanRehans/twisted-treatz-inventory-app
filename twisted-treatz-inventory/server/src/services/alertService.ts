// ─── Low-Stock Alert Service ─────────────────────────────────────────
// Checks stock levels after removals and sends email alerts via SendGrid.
// One alert per product per day. Never throws — errors are logged only.

import sgMail from "@sendgrid/mail";
import { PrismaClient } from "@prisma/client";
import { lowStockEmailHtml, lowStockEmailSubject } from "./emailTemplates.js";

const prisma = new PrismaClient();

// ─── SendGrid Configuration ─────────────────────────────────────────
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const ALERT_FROM_EMAIL = process.env.ALERT_FROM_EMAIL;
const ALERT_TO_EMAIL = process.env.ALERT_TO_EMAIL;

let sendgridReady = false;

if (SENDGRID_API_KEY && SENDGRID_API_KEY !== "placeholder-set-in-production") {
  sgMail.setApiKey(SENDGRID_API_KEY);
  sendgridReady = true;
} else {
  console.warn(
    "[AlertService] SENDGRID_API_KEY is not set or is a placeholder. Email alerts are disabled.",
  );
}

if (!ALERT_FROM_EMAIL) {
  console.warn("[AlertService] ALERT_FROM_EMAIL is not set. Email alerts will fail.");
}

if (!ALERT_TO_EMAIL) {
  console.warn("[AlertService] ALERT_TO_EMAIL is not set. Email alerts will fail.");
}

// ─── Public Interface ────────────────────────────────────────────────

export interface RemovalAlertInfo {
  memberName: string;
  qty: number;
}

/**
 * Main entry point — called after every successful removal.
 * Checks if the product is at or below threshold, and if no alert
 * has been sent today, sends one and logs it.
 *
 * NEVER throws. All errors are caught and logged.
 */
export async function checkAndSendAlert(
  productId: number,
  removalInfo: RemovalAlertInfo,
): Promise<void> {
  try {
    // Fetch the product with current qty and threshold
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        category: true,
        currentQty: true,
        alertThreshold: true,
      },
    });

    if (!product) {
      console.error(`[AlertService] Product ${productId} not found`);
      return;
    }

    // Only alert if stock is at or below threshold
    if (product.currentQty > product.alertThreshold) {
      return;
    }

    // Check if we already sent an alert for this product today
    const alreadySent = await getDailyAlertStatus(productId);
    if (alreadySent) {
      console.log(
        `[AlertService] Alert already sent today for "${product.name}" (ID: ${productId}). Skipping.`,
      );
      return;
    }

    // Fetch all products currently at or below their own threshold.
    // Prisma doesn't support column-to-column comparison, so we use raw SQL.
    const lowStockProducts = await prisma.$queryRaw<ProductAlertData[]>`
      SELECT id, name, category, "currentQty" AS "currentQty", "alertThreshold" AS "alertThreshold"
      FROM "Product"
      WHERE active = true
        AND "currentQty" <= "alertThreshold"
      ORDER BY "currentQty" ASC
    `;

    // Send the email
    await sendLowStockEmail(product, removalInfo, lowStockProducts);

    // Log to AlertLog so we don't send again today
    await prisma.alertLog.create({
      data: { productId },
    });

    console.log(
      `[AlertService] Low stock alert sent for "${product.name}" (qty: ${product.currentQty}, threshold: ${product.alertThreshold})`,
    );
  } catch (err) {
    console.error("[AlertService] Error in checkAndSendAlert:", err);
  }
}

/**
 * Returns true if an alert has already been sent for this product today (UTC).
 */
export async function getDailyAlertStatus(productId: number): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  const existing = await prisma.alertLog.findFirst({
    where: {
      productId,
      sentAt: {
        gte: todayStart,
        lte: todayEnd,
      },
    },
  });

  return existing !== null;
}

// ─── Private ─────────────────────────────────────────────────────────

interface ProductAlertData {
  id: number;
  name: string;
  category: string;
  currentQty: number;
  alertThreshold: number;
}

async function sendLowStockEmail(
  product: ProductAlertData,
  removalInfo: RemovalAlertInfo,
  allLowStockProducts: ProductAlertData[],
): Promise<void> {
  if (!sendgridReady || !ALERT_FROM_EMAIL || !ALERT_TO_EMAIL) {
    console.warn(
      "[AlertService] Email not sent — SendGrid is not configured. " +
        `Product: "${product.name}", Qty: ${product.currentQty}, Threshold: ${product.alertThreshold}`,
    );
    return;
  }

  const msg = {
    to: ALERT_TO_EMAIL,
    from: ALERT_FROM_EMAIL,
    subject: lowStockEmailSubject(product.name),
    html: lowStockEmailHtml(
      product,
      {
        memberName: removalInfo.memberName,
        qty: removalInfo.qty,
        removedAt: new Date(),
      },
      allLowStockProducts,
    ),
  };

  await sgMail.send(msg);
}
