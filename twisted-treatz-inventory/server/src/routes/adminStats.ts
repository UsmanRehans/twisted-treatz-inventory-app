import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();

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

// ─── GET /api/v1/admin/activity ────────────────────────────────────
// Admin only — unified feed of all three movement types (Removal,
// Receipt, Adjustment) so "when did we add X?" is a filter, not an
// archaeology dig. Merge strategy: take the newest (skip+limit) rows
// from each table, merge-sort, slice — correct pagination without a
// raw UNION, and trivially small at this scale.
router.get("/activity", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const { type, memberId, category, startDate, endDate, page: pageParam, limit: limitParam } = req.query;

    const page = Math.max(1, Number(pageParam) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));
    const skip = (page - 1) * limit;
    const fetchCount = skip + limit;

    // Shared filters
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (startDate && typeof startDate === "string") createdAt.gte = new Date(startDate);
    if (endDate && typeof endDate === "string") {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    const dateFilter = createdAt.gte || createdAt.lte ? { createdAt } : {};
    const productFilter =
      category && typeof category === "string" ? { product: { category } } : {};

    const wantType = (t: string) => !type || type === "all" || type === t;
    // A member filter only ever matches removals
    const member = memberId ? Number(memberId) : undefined;
    const includeRemovals = wantType("removal");
    const includeReceipts = wantType("receipt") && !member;
    const includeAdjustments = wantType("adjustment") && !member;

    const removalWhere = {
      ...dateFilter,
      ...productFilter,
      ...(member && !isNaN(member) ? { teamMemberId: member } : {}),
    };
    const receiptWhere = { ...dateFilter, ...productFilter };
    const adjustmentWhere = { ...dateFilter, ...productFilter };

    const productSelect = { select: { name: true, category: true } };

    const [removals, receipts, adjustments, removalCount, receiptCount, adjustmentCount] =
      await Promise.all([
        includeRemovals
          ? prisma.removal.findMany({
              where: removalWhere,
              include: { product: productSelect, teamMember: { select: { name: true } } },
              orderBy: { createdAt: "desc" },
              take: fetchCount,
            })
          : Promise.resolve([]),
        includeReceipts
          ? prisma.receipt.findMany({
              where: receiptWhere,
              include: { product: productSelect, admin: { select: { name: true } } },
              orderBy: { createdAt: "desc" },
              take: fetchCount,
            })
          : Promise.resolve([]),
        includeAdjustments
          ? prisma.adjustment.findMany({
              where: adjustmentWhere,
              include: { product: productSelect, admin: { select: { name: true } } },
              orderBy: { createdAt: "desc" },
              take: fetchCount,
            })
          : Promise.resolve([]),
        includeRemovals ? prisma.removal.count({ where: removalWhere }) : Promise.resolve(0),
        includeReceipts ? prisma.receipt.count({ where: receiptWhere }) : Promise.resolve(0),
        includeAdjustments
          ? prisma.adjustment.count({ where: adjustmentWhere })
          : Promise.resolve(0),
      ]);

    const events = [
      ...removals.map((r) => ({
        type: "removal" as const,
        id: `removal-${r.id}`,
        productId: r.productId,
        productName: r.product.name,
        productCategory: r.product.category,
        actorName: r.teamMember.name,
        delta: -r.qty,
        qtyAfter: r.qtyAfter as number | null,
        note: null as string | null,
        createdAt: r.createdAt,
      })),
      ...receipts.map((r) => ({
        type: "receipt" as const,
        id: `receipt-${r.id}`,
        productId: r.productId,
        productName: r.product.name,
        productCategory: r.product.category,
        actorName: r.admin.name,
        delta: r.actualQty,
        qtyAfter: null as number | null, // receipts predate snapshots
        note: r.notes,
        createdAt: r.createdAt,
      })),
      ...adjustments.map((a) => ({
        type: "adjustment" as const,
        id: `adjustment-${a.id}`,
        productId: a.productId,
        productName: a.product.name,
        productCategory: a.product.category,
        actorName: a.admin.name,
        delta: a.delta,
        qtyAfter: a.qtyAfter as number | null,
        note: a.reason,
        createdAt: a.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        events,
        total: removalCount + receiptCount + adjustmentCount,
        page,
        limit,
      },
    });
  } catch (err) {
    console.error("Admin activity feed error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
