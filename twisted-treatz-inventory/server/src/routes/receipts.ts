import { Router, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();
const prisma = new PrismaClient();

// ─── POST /api/v1/receipts ───────────────────────────────────────
// Admin only — record a received shipment (increment stock)
router.post("/", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const { productId, expectedQty, actualQty, supplier, unitPrice, notes } = req.body;
    const adminId = req.admin!.adminId;

    // Validate productId
    if (!productId || typeof productId !== "number" || !Number.isInteger(productId)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "productId must be a valid integer",
      });
      return;
    }

    // Validate expectedQty
    if (expectedQty === undefined || expectedQty === null || typeof expectedQty !== "number" || expectedQty <= 0 || !Number.isInteger(expectedQty)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "expectedQty must be a positive integer",
      });
      return;
    }

    // Validate actualQty
    if (actualQty === undefined || actualQty === null || typeof actualQty !== "number" || actualQty <= 0 || !Number.isInteger(actualQty)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "actualQty must be a positive integer",
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

    // Atomic transaction: update product qty + create receipt record
    const [, receipt] = await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: { currentQty: product.currentQty + actualQty },
      }),
      prisma.receipt.create({
        data: {
          productId,
          adminId,
          supplier: supplier || null,
          expectedQty,
          actualQty,
          unitPrice: unitPrice != null ? unitPrice : null,
          notes: notes || null,
        },
      }),
    ]);

    res.status(201).json({
      success: true,
      data: {
        receipt: {
          id: receipt.id,
          productId: receipt.productId,
          productName: product.name,
          adminId: receipt.adminId,
          supplier: receipt.supplier,
          expectedQty: receipt.expectedQty,
          actualQty: receipt.actualQty,
          unitPrice: receipt.unitPrice,
          notes: receipt.notes,
          createdAt: receipt.createdAt,
        },
      },
    });
  } catch (err) {
    console.error("Receipt creation error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── GET /api/v1/receipts ────────────────────────────────────────
// Admin only — list receipt history with filters + pagination
router.get("/", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const {
      productId,
      supplier,
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
    const where: Prisma.ReceiptWhereInput = {};

    if (productId) {
      const id = Number(productId);
      if (!isNaN(id)) where.productId = id;
    }

    if (supplier && typeof supplier === "string") {
      where.supplier = { contains: supplier, mode: "insensitive" };
    }

    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate && typeof startDate === "string") {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate && typeof endDate === "string") {
        // Include the full end date day
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Sorting
    const validSortFields = ["createdAt", "expectedQty", "actualQty"];
    const sortField = validSortFields.includes(sort as string)
      ? (sort as string)
      : "createdAt";
    const sortOrder = order === "asc" ? "asc" : "desc";

    // Fetch receipts + total count in parallel
    const [receipts, total] = await Promise.all([
      prisma.receipt.findMany({
        where,
        include: {
          product: {
            select: { name: true, category: true },
          },
        },
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.receipt.count({ where }),
    ]);

    // Shape response
    const shaped = receipts.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      productCategory: r.product.category,
      adminId: r.adminId,
      supplier: r.supplier,
      expectedQty: r.expectedQty,
      actualQty: r.actualQty,
      unitPrice: r.unitPrice,
      notes: r.notes,
      createdAt: r.createdAt,
    }));

    res.json({
      success: true,
      data: {
        receipts: shaped,
        total,
        page,
        limit,
      },
    });
  } catch (err) {
    console.error("Receipts fetch error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── GET /api/v1/receipts/:id ────────────────────────────────────
// Admin only — get single receipt detail
router.get("/:id", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id) || !Number.isInteger(id)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "Receipt ID must be a valid integer",
      });
      return;
    }

    const receipt = await prisma.receipt.findUnique({
      where: { id },
      include: {
        product: {
          select: { name: true, category: true },
        },
      },
    });

    if (!receipt) {
      res.status(404).json({
        success: false,
        data: null,
        error: "Receipt not found",
      });
      return;
    }

    res.json({
      success: true,
      data: {
        receipt: {
          id: receipt.id,
          productId: receipt.productId,
          productName: receipt.product.name,
          productCategory: receipt.product.category,
          adminId: receipt.adminId,
          supplier: receipt.supplier,
          expectedQty: receipt.expectedQty,
          actualQty: receipt.actualQty,
          unitPrice: receipt.unitPrice,
          notes: receipt.notes,
          createdAt: receipt.createdAt,
        },
      },
    });
  } catch (err) {
    console.error("Receipt fetch error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
