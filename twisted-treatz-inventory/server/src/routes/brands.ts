import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";
import { requireAnyAuth, AuthedRequest } from "../middleware/requireAnyAuth.js";
import { normalizeBrandName } from "../lib/brand.js";

const router = Router();

const brandSelect = {
  id: true,
  name: true,
  active: true,
} satisfies Prisma.BrandSelect;

// ─── GET /api/v1/brands ────────────────────────────────────────────
// Any authenticated user — backs the brand picker (admin) and filters.
// Active brands only; sorted by name.
router.get("/", requireAnyAuth, async (_req: AuthedRequest, res: Response) => {
  try {
    const brands = await prisma.brand.findMany({
      where: { active: true },
      select: brandSelect,
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: brands });
  } catch (err) {
    console.error("Brands fetch error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

// ─── POST /api/v1/brands ───────────────────────────────────────────
// Admin only — create a brand. Name is normalized to the canonical form
// (same normalizer as the backfill). The @unique index enforces dedup;
// a duplicate returns 409.
router.post("/", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const name = normalizeBrandName(req.body?.name);
    if (!name) {
      res.status(400).json({ success: false, data: null, error: "name is required" });
      return;
    }

    const brand = await prisma.brand.create({
      data: { name },
      select: brandSelect,
    });
    res.status(201).json({ success: true, data: brand });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ success: false, data: null, error: "Brand already exists" });
      return;
    }
    console.error("Brand create error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

// ─── PATCH /api/v1/brands/:id ──────────────────────────────────────
// Admin only — rename or activate/deactivate. Soft-delete via active:false
// (there is no hard DELETE). Renames are normalized and dedup-checked.
router.patch("/:id", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, data: null, error: "Invalid brand ID" });
      return;
    }

    const updateData: Record<string, unknown> = {};

    if (req.body?.name !== undefined) {
      const name = normalizeBrandName(req.body.name);
      if (!name) {
        res.status(400).json({ success: false, data: null, error: "name cannot be empty" });
        return;
      }
      updateData.name = name;
    }

    if (req.body?.active !== undefined) {
      if (typeof req.body.active !== "boolean") {
        res.status(400).json({ success: false, data: null, error: "active must be a boolean" });
        return;
      }
      updateData.active = req.body.active;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        data: null,
        error: "No valid fields to update. Allowed: name, active",
      });
      return;
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: updateData,
      select: brandSelect,
    });
    res.json({ success: true, data: brand });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        res.status(409).json({ success: false, data: null, error: "Brand already exists" });
        return;
      }
      if (err.code === "P2025") {
        res.status(404).json({ success: false, data: null, error: "Brand not found" });
        return;
      }
    }
    console.error("Brand update error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

export default router;
