import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();
const prisma = new PrismaClient();

// ─── GET /api/v1/admin/stats ───────────────────────────────────────
// Admin only — dashboard statistics
router.get("/stats", requireAdmin, async (_req: AdminRequest, res: Response) => {
  try {
    // Total active SKUs
    const totalActiveSKUs = await prisma.product.count({
      where: { active: true },
    });

    // Low stock count: products where currentQty <= alertThreshold
    // Using raw query since Prisma doesn't support column-to-column comparison
    const lowStockResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "Product"
      WHERE active = true AND "currentQty" <= "alertThreshold"
    `;
    const lowStockCount = Number(lowStockResult[0].count);

    // Total units removed today (UTC day boundaries)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const removedTodayResult = await prisma.removal.aggregate({
      _sum: { qty: true },
      where: {
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    });
    const totalRemovedToday = removedTodayResult._sum.qty ?? 0;

    // Last receipt date
    const lastReceipt = await prisma.receipt.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    // Low stock products list
    const lowStockProducts = await prisma.$queryRaw<
      { id: number; name: string; category: string; currentQty: number; alertThreshold: number }[]
    >`
      SELECT id, name, category, "currentQty", "alertThreshold" FROM "Product"
      WHERE active = true AND "currentQty" <= "alertThreshold"
      ORDER BY "currentQty" ASC
    `;

    res.json({
      success: true,
      data: {
        totalActiveSKUs,
        lowStockCount,
        totalRemovedToday,
        lastReceiptDate: lastReceipt?.createdAt ?? null,
        lowStockProducts,
      },
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
