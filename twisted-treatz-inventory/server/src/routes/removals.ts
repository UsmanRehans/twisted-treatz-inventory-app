import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { parseChicagoDate } from "../lib/businessDay.js";
import { requireTeamMember, TeamMemberRequest } from "../middleware/requireTeamMember.js";
import { requireAnyAuth, AuthedRequest } from "../middleware/requireAnyAuth.js";
import { checkAndSendAlert } from "../services/alertService.js";

const router = Router();

// ─── POST /api/v1/removals ────────────────────────────────────────
// Team member only — create a removal (decrement stock)
router.post("/", requireTeamMember, async (req: TeamMemberRequest, res: Response) => {
  try {
    const { productId, qty } = req.body;
    const teamMemberId = req.teamMember!.memberId;
    const memberName = req.teamMember!.name;

    // Validate qty
    if (qty === undefined || qty === null || typeof qty !== "number" || qty <= 0 || !Number.isInteger(qty)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "qty must be a positive integer",
      });
      return;
    }

    // Validate productId
    if (!productId || typeof productId !== "number" || !Number.isInteger(productId)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "productId must be a valid integer",
      });
      return;
    }

    // Check product exists and is active
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, currentQty: true, active: true },
    });

    if (!product || !product.active) {
      res.status(404).json({
        success: false,
        data: null,
        error: "Product not found or inactive",
      });
      return;
    }

    // Fast-path stock check for a clear message; the authoritative check is
    // the guarded decrement below.
    if (product.currentQty < qty) {
      res.status(400).json({
        success: false,
        data: null,
        error: `Insufficient stock. Current quantity: ${product.currentQty}, requested: ${qty}`,
      });
      return;
    }

    // Guarded, atomic decrement. The WHERE clause re-checks the live qty
    // inside the transaction, so two overlapping removals cannot both take
    // the same units (a read-then-write let the second silently overwrite
    // the first). The snapshots come from the row we just updated and the
    // Removal row is written in the same transaction.
    const removal = await prisma.$transaction(async (tx) => {
      const guarded = await tx.product.updateMany({
        where: { id: productId, active: true, currentQty: { gte: qty } },
        data: { currentQty: { decrement: qty } },
      });
      if (guarded.count === 0) return null;
      const after = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: { currentQty: true },
      });
      return tx.removal.create({
        data: {
          productId,
          teamMemberId,
          qty,
          qtyBefore: after.currentQty + qty,
          qtyAfter: after.currentQty,
        },
      });
    });

    if (!removal) {
      // Lost the race to a concurrent removal/receipt: report the live qty
      const live = await prisma.product.findUnique({
        where: { id: productId },
        select: { currentQty: true },
      });
      res.status(400).json({
        success: false,
        data: null,
        error: `Insufficient stock. Current quantity: ${live?.currentQty ?? 0}, requested: ${qty}`,
      });
      return;
    }

    // Fire-and-forget: check if low-stock alert is needed.
    // Never block the response — errors are logged internally.
    void checkAndSendAlert(productId, { memberName, qty }).catch((err) => {
      console.error("[Removals] Alert check failed (non-blocking):", err);
    });

    res.status(201).json({
      success: true,
      data: {
        removal: {
          id: removal.id,
          productId: removal.productId,
          productName: product.name,
          teamMemberId: removal.teamMemberId,
          memberName,
          qty: removal.qty,
          qtyBefore: removal.qtyBefore,
          qtyAfter: removal.qtyAfter,
          createdAt: removal.createdAt,
        },
      },
    });
  } catch (err) {
    console.error("Removal creation error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── GET /api/v1/removals ─────────────────────────────────────────
// Any authenticated user (admin OR team token) — list removals
// (activity log) with filters + pagination
router.get("/", requireAnyAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const {
      memberId,
      productId,
      category,
      startDate,
      endDate,
      page: pageParam,
      limit: limitParam,
      sort,
      order,
    } = req.query;

    // Pagination defaults
    const page = Math.max(1, Number(pageParam) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.RemovalWhereInput = {};

    if (memberId) {
      const id = Number(memberId);
      if (!isNaN(id)) where.teamMemberId = id;
    }

    if (productId) {
      const id = Number(productId);
      if (!isNaN(id)) where.productId = id;
    }

    if (category && typeof category === "string") {
      where.product = { category };
    }

    // Date range filter — Chicago calendar days (YYYY-MM-DD), so an evening
    // entry lands on the day the floor saw it, not the next UTC day.
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        const day = parseChicagoDate(startDate);
        if (!day) {
          res.status(400).json({ success: false, data: null, error: "startDate must be YYYY-MM-DD" });
          return;
        }
        where.createdAt.gte = day.start;
      }
      if (endDate) {
        const day = parseChicagoDate(endDate);
        if (!day) {
          res.status(400).json({ success: false, data: null, error: "endDate must be YYYY-MM-DD" });
          return;
        }
        where.createdAt.lte = day.end;
      }
    }

    // Sorting
    const validSortFields = ["createdAt", "qty"];
    const sortField = validSortFields.includes(sort as string)
      ? (sort as string)
      : "createdAt";
    const sortOrder = order === "asc" ? "asc" : "desc";

    // Fetch removals + total count in parallel
    const [removals, total] = await Promise.all([
      prisma.removal.findMany({
        where,
        include: {
          product: {
            select: { name: true, category: true },
          },
          teamMember: {
            select: { name: true },
          },
        },
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.removal.count({ where }),
    ]);

    // Shape response
    const shaped = removals.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      productCategory: r.product.category,
      teamMemberId: r.teamMemberId,
      memberName: r.teamMember.name,
      qty: r.qty,
      qtyBefore: r.qtyBefore,
      qtyAfter: r.qtyAfter,
      createdAt: r.createdAt,
    }));

    res.json({
      success: true,
      data: {
        removals: shaped,
        total,
        page,
        limit,
      },
    });
  } catch (err) {
    console.error("Removals fetch error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
