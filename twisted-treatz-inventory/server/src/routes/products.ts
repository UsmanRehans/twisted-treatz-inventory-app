import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();
const prisma = new PrismaClient();

// ─── GET /api/v1/products/categories ───────────────────────────────
// Public — iPad needs this for category tabs
// Must be defined BEFORE /:id to avoid route conflict
router.get("/categories", async (_req: Request, res: Response) => {
  try {
    const results = await prisma.product.findMany({
      where: { active: true },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });

    const categories = results.map((r) => r.category);

    res.json({
      success: true,
      data: categories,
    });
  } catch (err) {
    console.error("Categories fetch error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── GET /api/v1/products ──────────────────────────────────────────
// Public — iPad needs this to browse products
// Query params: ?category=Gummy&search=bear&sort=name&order=asc
router.get("/", async (req: Request, res: Response) => {
  try {
    const { category, search, sort, order } = req.query;

    // Build where clause
    const where: Prisma.ProductWhereInput = { active: true };

    if (category && typeof category === "string") {
      where.category = category;
    }

    if (search && typeof search === "string") {
      where.name = { contains: search, mode: "insensitive" };
    }

    // Build orderBy
    const validSortFields = ["name", "category", "currentQty"];
    const sortField = validSortFields.includes(sort as string)
      ? (sort as string)
      : "name";
    const sortOrder = order === "desc" ? "desc" : "asc";

    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        category: true,
        flavor: true,
        purchaseUnit: true,
        unitSize: true,
        brand: true,
        supplier: true,
        usedIn: true,
        currentQty: true,
        alertThreshold: true,
        unitPrice: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { [sortField]: sortOrder },
    });

    res.json({
      success: true,
      data: products,
    });
  } catch (err) {
    console.error("Products fetch error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── GET /api/v1/products/:id ──────────────────────────────────────
// Public — get single product by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "Invalid product ID",
      });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        category: true,
        flavor: true,
        purchaseUnit: true,
        unitSize: true,
        brand: true,
        supplier: true,
        usedIn: true,
        currentQty: true,
        alertThreshold: true,
        unitPrice: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!product) {
      res.status(404).json({
        success: false,
        data: null,
        error: "Product not found",
      });
      return;
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (err) {
    console.error("Product fetch error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── PATCH /api/v1/products/:id ────────────────────────────────────
// Admin only — update product fields (threshold editing, etc.)
router.patch("/:id", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "Invalid product ID",
      });
      return;
    }

    // Only allow specific fields to be updated
    const allowedFields = ["alertThreshold", "name", "category", "active", "unitPrice"];
    const updateData: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        data: null,
        error: "No valid fields to update. Allowed: alertThreshold, name, category, active, unitPrice",
      });
      return;
    }

    // Validate alertThreshold if provided
    if (updateData.alertThreshold !== undefined) {
      const threshold = Number(updateData.alertThreshold);
      if (isNaN(threshold) || threshold < 0) {
        res.status(400).json({
          success: false,
          data: null,
          error: "alertThreshold must be a non-negative number",
        });
        return;
      }
      updateData.alertThreshold = threshold;
    }

    // Convert unitPrice to Decimal if provided
    if (updateData.unitPrice !== undefined && updateData.unitPrice !== null) {
      updateData.unitPrice = new Prisma.Decimal(updateData.unitPrice as string | number);
    }

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        category: true,
        flavor: true,
        purchaseUnit: true,
        unitSize: true,
        brand: true,
        supplier: true,
        usedIn: true,
        currentQty: true,
        alertThreshold: true,
        unitPrice: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({
      success: true,
      data: product,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      res.status(404).json({
        success: false,
        data: null,
        error: "Product not found",
      });
      return;
    }
    console.error("Product update error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
