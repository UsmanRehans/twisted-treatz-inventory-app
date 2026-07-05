import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";
import { requireAnyAuth, AuthedRequest } from "../middleware/requireAnyAuth.js";
import { normalizeUom, parsePackSize } from "../lib/measure.js";

const router = Router();

// ─── Shared product shape ───────────────────────────────────────────
// Brand is a relation now, but the wire contract keeps `brand` as a flat
// string (the brand name) so the existing client (Receiving search,
// ProductTable) needs no rewrite, plus `brandId` for filtering/editing.
const productSelect = {
  id: true,
  name: true,
  category: true,
  flavor: true,
  purchaseUnit: true,
  unitSize: true,
  packSize: true,
  uom: true,
  brandId: true,
  brand: { select: { id: true, name: true } },
  supplier: true,
  usedIn: true,
  currentQty: true,
  alertThreshold: true,
  unitPrice: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

// Flatten the brand relation to a name string for the response.
function shapeProduct(p: ProductRow) {
  const { brand, ...rest } = p;
  return { ...rest, brand: brand?.name ?? null };
}

// ─── GET /api/v1/products/categories ───────────────────────────────
// Any authenticated user — iPad fetches this after PIN verification.
// Must be defined BEFORE /:id to avoid route conflict
router.get("/categories", requireAnyAuth, async (_req: AuthedRequest, res: Response) => {
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
// Any authenticated user — iPad fetches this after PIN verification.
// Query params: ?category=Gummy&brandId=3&search=bear&sort=name&order=asc
// Admin tokens may also pass ?includeInactive=true to see deactivated
// products (for the Show-inactive toggle); the flag is silently ignored
// for team tokens so the floor iPad can never surface retired SKUs.
router.get("/", requireAnyAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const { category, brandId, search, sort, order, includeInactive } = req.query;

    // Build where clause
    const where: Prisma.ProductWhereInput = {};
    if (includeInactive !== "true" || !req.admin) {
      where.active = true;
    }

    if (category && typeof category === "string") {
      where.category = category;
    }

    if (brandId && typeof brandId === "string" && !isNaN(Number(brandId))) {
      where.brandId = Number(brandId);
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
      select: productSelect,
      orderBy: { [sortField]: sortOrder },
    });

    res.json({
      success: true,
      data: products.map(shapeProduct),
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

// ─── POST /api/v1/products ─────────────────────────────────────────
// Admin only — create a brand-new SKU.
// INVARIANT: a new product is created with currentQty:0, ALWAYS. Creating
// a product is not a backdoor to inject stock without an audit record —
// stock arrives only via Receipts. currentQty is never read from the body.
router.post("/", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const {
      name,
      category,
      flavor,
      purchaseUnit,
      unitSize,
      packSize,
      uom,
      brandId,
      supplier,
      usedIn,
      alertThreshold,
      unitPrice,
    } = req.body;

    // Required fields
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ success: false, data: null, error: "name is required" });
      return;
    }
    if (!category || typeof category !== "string" || !category.trim()) {
      res.status(400).json({ success: false, data: null, error: "category is required" });
      return;
    }
    if (!purchaseUnit || typeof purchaseUnit !== "string" || !purchaseUnit.trim()) {
      res.status(400).json({ success: false, data: null, error: "purchaseUnit is required" });
      return;
    }

    // Optional brandId: if present, must reference an existing brand
    if (brandId !== undefined && brandId !== null) {
      if (!Number.isInteger(brandId)) {
        res.status(400).json({ success: false, data: null, error: "brandId must be an integer" });
        return;
      }
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: { id: true },
      });
      if (!brand) {
        res.status(400).json({ success: false, data: null, error: "brand not found" });
        return;
      }
    }

    // packSize: optional numeric (Hani's "Pack Size"); reject if present-but-bad
    const packParsed = parsePackSize(packSize);
    if (!packParsed.ok) {
      res.status(400).json({ success: false, data: null, error: packParsed.reason });
      return;
    }

    // unitPrice: optional, must be a non-negative number if present
    if (unitPrice !== undefined && unitPrice !== null) {
      const price = Number(unitPrice);
      if (isNaN(price) || price < 0) {
        res.status(400).json({
          success: false,
          data: null,
          error: "unitPrice must be a non-negative number",
        });
        return;
      }
    }

    // alertThreshold: optional, defaults to 10, must be non-negative
    let threshold = 10;
    if (alertThreshold !== undefined && alertThreshold !== null) {
      threshold = Number(alertThreshold);
      if (isNaN(threshold) || threshold < 0) {
        res.status(400).json({
          success: false,
          data: null,
          error: "alertThreshold must be a non-negative number",
        });
        return;
      }
    }

    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        category: category.trim(),
        flavor: flavor ?? null,
        purchaseUnit: purchaseUnit.trim(),
        unitSize: unitSize ?? null,
        packSize: packParsed.value,
        uom: normalizeUom(uom),
        brandId: brandId ?? null,
        supplier: supplier ?? null,
        usedIn: usedIn ?? null,
        currentQty: 0, // ← hard-coded. Never from req.body. See invariant above.
        alertThreshold: threshold,
        unitPrice:
          unitPrice !== undefined && unitPrice !== null
            ? new Prisma.Decimal(unitPrice as string | number)
            : null,
        active: true,
      },
      select: productSelect,
    });

    res.status(201).json({ success: true, data: shapeProduct(product) });
  } catch (err) {
    console.error("Product create error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── GET /api/v1/products/:id ──────────────────────────────────────
// Any authenticated user — get single product by ID
router.get("/:id", requireAnyAuth, async (req: AuthedRequest, res: Response) => {
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
      select: productSelect,
    });

    // Inactive products are admin-only, same as the list endpoint — the
    // floor iPad must never see retired SKUs, even by ID. 404 (not 403)
    // so a team token can't probe which IDs exist.
    if (!product || (!product.active && !req.admin)) {
      res.status(404).json({
        success: false,
        data: null,
        error: "Product not found",
      });
      return;
    }

    res.json({
      success: true,
      data: shapeProduct(product),
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
// Admin only — update product fields (threshold editing, brand reassign, etc.)
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

    // Only allow specific fields to be updated. currentQty is deliberately
    // NOT here — stock only moves through Removals/Receipts/Adjustments.
    const allowedFields = [
      "alertThreshold",
      "name",
      "category",
      "active",
      "unitPrice",
      "brandId",
      "packSize",
      "uom",
      "purchaseUnit",
      "flavor",
      "supplier",
      "usedIn",
    ];
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
        error:
          "No valid fields to update. Allowed: alertThreshold, name, category, active, unitPrice, brandId, packSize, uom, purchaseUnit, flavor, supplier, usedIn",
      });
      return;
    }

    // String fields: must be non-empty strings where required by the model
    // (name, category, purchaseUnit); optional ones (flavor, supplier,
    // usedIn) accept null to clear. All are trimmed and length-capped.
    const MAX_STR = 200;
    const requiredStrings = ["name", "category", "purchaseUnit"] as const;
    const optionalStrings = ["flavor", "supplier", "usedIn"] as const;

    for (const field of requiredStrings) {
      const val = updateData[field];
      if (val === undefined) continue;
      if (typeof val !== "string" || !val.trim() || val.trim().length > MAX_STR) {
        res.status(400).json({
          success: false,
          data: null,
          error: `${field} must be a non-empty string (max ${MAX_STR} chars)`,
        });
        return;
      }
      updateData[field] = val.trim();
    }

    for (const field of optionalStrings) {
      const val = updateData[field];
      if (val === undefined || val === null) continue;
      if (typeof val !== "string" || val.trim().length > MAX_STR) {
        res.status(400).json({
          success: false,
          data: null,
          error: `${field} must be a string (max ${MAX_STR} chars) or null`,
        });
        return;
      }
      updateData[field] = val.trim() || null;
    }

    // active must be a boolean if provided
    if (updateData.active !== undefined && typeof updateData.active !== "boolean") {
      res.status(400).json({
        success: false,
        data: null,
        error: "active must be a boolean",
      });
      return;
    }

    // Normalize packSize / uom if provided. null clears the field.
    if (updateData.packSize !== undefined && updateData.packSize !== null) {
      const packParsed = parsePackSize(updateData.packSize);
      if (!packParsed.ok) {
        res.status(400).json({ success: false, data: null, error: packParsed.reason });
        return;
      }
      updateData.packSize = packParsed.value;
    }
    if (updateData.uom !== undefined && updateData.uom !== null) {
      updateData.uom = normalizeUom(updateData.uom);
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

    // Validate brandId if provided. null clears the brand; an integer must
    // reference an existing brand.
    if (updateData.brandId !== undefined && updateData.brandId !== null) {
      if (!Number.isInteger(updateData.brandId)) {
        res.status(400).json({ success: false, data: null, error: "brandId must be an integer" });
        return;
      }
      const brand = await prisma.brand.findUnique({
        where: { id: updateData.brandId as number },
        select: { id: true },
      });
      if (!brand) {
        res.status(400).json({ success: false, data: null, error: "brand not found" });
        return;
      }
    }

    // Convert unitPrice to Decimal if provided
    if (updateData.unitPrice !== undefined && updateData.unitPrice !== null) {
      const price = Number(updateData.unitPrice);
      if (isNaN(price) || price < 0) {
        res.status(400).json({
          success: false,
          data: null,
          error: "unitPrice must be a non-negative number",
        });
        return;
      }
      updateData.unitPrice = new Prisma.Decimal(price);
    }

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
      select: productSelect,
    });

    res.json({
      success: true,
      data: shapeProduct(product),
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
