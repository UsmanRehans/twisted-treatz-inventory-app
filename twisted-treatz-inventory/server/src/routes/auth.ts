import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import { generateAdminToken, generateTeamMemberToken } from "../services/tokenService.js";

const router = Router();

// ─── Login rate limiting ────────────────────────────────────────────
// In-memory tracker keyed by attempt identity:
//   team PIN:    "pin:<memberId>"
//   admin login: "admin:<email>" and "admin-ip:<ip>"
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record || now - record.windowStart > WINDOW_MS) {
    // Window expired or first attempt — reset
    loginAttempts.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (record.count >= MAX_ATTEMPTS) {
    return false; // blocked
  }

  record.count++;
  return true;
}

function resetRateLimit(...keys: string[]): void {
  for (const key of keys) loginAttempts.delete(key);
}

// ─── POST /api/v1/auth/admin/login ──────────────────────────────────
router.post("/admin/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({
        success: false,
        data: null,
        error: "Email and password are required",
      });
      return;
    }

    // Rate limit by email and by source IP (5 failures / 15 min each)
    const emailKey = `admin:${email.toLowerCase()}`;
    const ipKey = `admin-ip:${req.ip}`;
    if (!checkRateLimit(emailKey) || !checkRateLimit(ipKey)) {
      res.status(429).json({
        success: false,
        data: null,
        error: "Too many failed attempts. Try again in 15 minutes.",
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

    // Successful — clear failure counters
    resetRateLimit(emailKey, ipKey);

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

    if (!memberId || !pin || !Number.isInteger(Number(memberId))) {
      res.status(400).json({
        success: false,
        data: null,
        error: "memberId and pin are required",
      });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(`pin:${Number(memberId)}`)) {
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
    resetRateLimit(`pin:${member.id}`);

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
