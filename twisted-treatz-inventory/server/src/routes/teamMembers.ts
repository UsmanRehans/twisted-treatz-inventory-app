import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();
const prisma = new PrismaClient();

// ─── GET /api/v1/team-members ───────────────────────────────────────
// Public endpoint — iPad needs this to show member selection screen
// Never returns pinHash
// If ?all=true and admin auth is present, returns all members (including inactive)
router.get("/", async (req: Request, res: Response) => {
  try {
    const showAll = req.query.all === "true";

    const members = await prisma.teamMember.findMany({
      where: showAll ? {} : { active: true },
      select: {
        id: true,
        name: true,
        initials: true,
        active: true,
      },
      orderBy: { name: "asc" },
    });

    res.json({
      success: true,
      data: members,
    });
  } catch (err) {
    console.error("Team members fetch error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── PATCH /api/v1/team-members/:id ─────────────────────────────────
// Admin only — update team member (reset PIN, toggle active)
router.patch("/:id", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id) || !Number.isInteger(id)) {
      res.status(400).json({
        success: false,
        data: null,
        error: "Invalid team member ID",
      });
      return;
    }

    // Check member exists
    const existing = await prisma.teamMember.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({
        success: false,
        data: null,
        error: "Team member not found",
      });
      return;
    }

    const updateData: Record<string, unknown> = {};

    // Handle PIN reset
    if (req.body.pin !== undefined) {
      const pin = String(req.body.pin);
      if (!/^\d{4}$/.test(pin)) {
        res.status(400).json({
          success: false,
          data: null,
          error: "PIN must be exactly 4 digits",
        });
        return;
      }
      const pinHash = await bcrypt.hash(pin, 10);
      updateData.pinHash = pinHash;
    }

    // Handle active toggle
    if (req.body.active !== undefined) {
      if (typeof req.body.active !== "boolean") {
        res.status(400).json({
          success: false,
          data: null,
          error: "active must be a boolean",
        });
        return;
      }
      updateData.active = req.body.active;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        data: null,
        error: "No valid fields to update. Allowed: pin, active",
      });
      return;
    }

    const member = await prisma.teamMember.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        initials: true,
        active: true,
      },
    });

    res.json({
      success: true,
      data: member,
    });
  } catch (err) {
    console.error("Team member update error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
