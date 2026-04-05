import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { generateAdminToken, generateTeamMemberToken } from "../services/tokenService.js";

const router = Router();
const prisma = new PrismaClient();

// ─── Rate limiting for team member PIN attempts ─────────────────────
// In-memory tracker: memberId -> { attempts, windowStart }
const pinAttempts = new Map<number, { count: number; windowStart: number }>();
const MAX_PIN_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(memberId: number): boolean {
  const now = Date.now();
  const record = pinAttempts.get(memberId);

  if (!record || now - record.windowStart > PIN_WINDOW_MS) {
    // Window expired or first attempt — reset
    pinAttempts.set(memberId, { count: 1, windowStart: now });
    return true;
  }

  if (record.count >= MAX_PIN_ATTEMPTS) {
    return false; // blocked
  }

  record.count++;
  return true;
}

function resetRateLimit(memberId: number): void {
  pinAttempts.delete(memberId);
}

// ─── POST /api/v1/auth/admin/login ──────────────────────────────────
router.post("/admin/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        data: null,
        error: "Email and password are required",
      });
      return;
    }

    const admin = await prisma.admin.findUnique({ where: { email } });

    if (!admin) {
      res.status(401).json({
        success: false,
        data: null,
        error: "Invalid email or password",
      });
      return;
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);

    if (!valid) {
      res.status(401).json({
        success: false,
        data: null,
        error: "Invalid email or password",
      });
      return;
    }

    const token = generateAdminToken({ id: admin.id, email: admin.email });

    res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
        },
      },
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── POST /api/v1/auth/team/verify ──────────────────────────────────
router.post("/team/verify", async (req: Request, res: Response) => {
  try {
    const { memberId, pin } = req.body;

    if (!memberId || !pin) {
      res.status(400).json({
        success: false,
        data: null,
        error: "memberId and pin are required",
      });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(memberId)) {
      res.status(429).json({
        success: false,
        data: null,
        error: "Too many failed attempts. Try again in 15 minutes.",
      });
      return;
    }

    const member = await prisma.teamMember.findUnique({
      where: { id: Number(memberId) },
    });

    if (!member || !member.active) {
      res.status(401).json({
        success: false,
        data: null,
        error: "Invalid member or PIN",
      });
      return;
    }

    const valid = await bcrypt.compare(String(pin), member.pinHash);

    if (!valid) {
      res.status(401).json({
        success: false,
        data: null,
        error: "Invalid member or PIN",
      });
      return;
    }

    // Successful — reset rate limit counter
    resetRateLimit(member.id);

    const token = generateTeamMemberToken({
      id: member.id,
      name: member.name,
      initials: member.initials,
    });

    res.json({
      success: true,
      data: {
        token,
        member: {
          id: member.id,
          name: member.name,
          initials: member.initials,
        },
      },
    });
  } catch (err) {
    console.error("Team verify error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
