// ─── HTML Email Templates for Low-Stock Alerts ──────────────────────

interface ProductInfo {
  id: number;
  name: string;
  category: string;
  currentQty: number;
  alertThreshold: number;
}

interface RemovalInfo {
  memberName: string;
  qty: number;
  removedAt: Date;
}

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || "https://twistedtreatz.com";

function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function lowStockEmailSubject(productName: string): string {
  return `\u26A0\uFE0F Low Stock Alert \u2014 ${productName} | Twisted Treatz`;
}

export function lowStockEmailHtml(
  product: ProductInfo,
  removalInfo: RemovalInfo,
  allLowStockProducts: ProductInfo[],
): string {
  const receiveLink = `${ADMIN_BASE_URL}/admin/receive?productId=${product.id}`;

  const otherLowStock = allLowStockProducts.filter((p) => p.id !== product.id);

  const otherLowStockRows = otherLowStock
    .map(
      (p) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${p.name}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">${p.category}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; text-align: center; color: #dc2626; font-weight: 600;">${p.currentQty}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; text-align: center;">${p.alertThreshold}</td>
      </tr>`,
    )
    .join("");

  const otherLowStockSection =
    otherLowStock.length > 0
      ? `
    <div style="margin-top: 32px;">
      <h3 style="color: #1f2937; font-size: 16px; margin-bottom: 12px;">All Products Currently Below Threshold (${otherLowStock.length} additional)</h3>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px;">
        <thead>
          <tr style="background-color: #f9fafb;">
            <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Product</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Category</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Current Qty</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 13px; color: #6b7280; border-bottom: 2px solid #e5e7eb;">Threshold</th>
          </tr>
        </thead>
        <tbody>
          ${otherLowStockRows}
        </tbody>
      </table>
    </div>`
      : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px;">

    <!-- Header -->
    <div style="background-color: #7c3aed; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Twisted Treatz Inventory</h1>
      <p style="color: #ddd6fe; margin: 4px 0 0 0; font-size: 14px;">Low Stock Alert</p>
    </div>

    <!-- Main Content -->
    <div style="background-color: #ffffff; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">

      <!-- Alert Banner -->
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0; color: #991b1b; font-size: 16px; font-weight: 600;">
          ${product.name} is running low
        </p>
        <p style="margin: 4px 0 0 0; color: #7f1d1d; font-size: 14px;">
          Current stock has dropped to <strong>${product.currentQty}</strong> units (threshold: ${product.alertThreshold})
        </p>
      </div>

      <!-- Product Details -->
      <table style="width: 100%; margin-bottom: 24px;">
        <tr>
          <td style="padding: 6px 0; color: #6b7280; font-size: 14px; width: 140px;">Product:</td>
          <td style="padding: 6px 0; color: #1f2937; font-size: 14px; font-weight: 600;">${product.name}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Category:</td>
          <td style="padding: 6px 0; color: #1f2937; font-size: 14px;">${product.category}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Current Quantity:</td>
          <td style="padding: 6px 0; color: #dc2626; font-size: 14px; font-weight: 600;">${product.currentQty}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Alert Threshold:</td>
          <td style="padding: 6px 0; color: #1f2937; font-size: 14px;">${product.alertThreshold}</td>
        </tr>
      </table>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">

      <!-- Removal Info -->
      <p style="color: #6b7280; font-size: 13px; margin: 0 0 4px 0;">Triggered by removal:</p>
      <p style="color: #1f2937; font-size: 14px; margin: 0;">
        <strong>${removalInfo.memberName}</strong> removed <strong>${removalInfo.qty}</strong> unit${removalInfo.qty > 1 ? "s" : ""} on ${formatDate(removalInfo.removedAt)}
      </p>

      <!-- CTA Button -->
      <div style="text-align: center; margin: 24px 0;">
        <a href="${receiveLink}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 600;">
          Receive Stock for ${product.name}
        </a>
      </div>

      <!-- Other Low Stock Products -->
      ${otherLowStockSection}

    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 12px;">
      <p style="margin: 0;">Twisted Treatz Inventory System</p>
      <p style="margin: 4px 0 0 0;">This is an automated alert. Do not reply to this email.</p>
    </div>

  </div>
</body>
</html>`;
}
