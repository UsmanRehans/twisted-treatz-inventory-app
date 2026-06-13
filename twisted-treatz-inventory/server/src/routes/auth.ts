import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { generateAdminToken, generateTeamMemberToken } from "../services/tokenService.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";
import { sendPasswordResetEmail } from "../services/passwordResetService.js";

const router = Router();

// ─── Login rate limiting ────────────────────────────────────────────
// In-memory tracker keyed by attempt identity:
//   team PIN:    "pin:<memberId>"
//   admin login: "admin:<email>" and "admin-ip:<ip>"
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key: string, maxAttempts: number = MAX_ATTEMPTS): boolean {
  const now = Date.now();
  const record = loginAttempts.get(key);

  if (!record || now - record.windowStart > WINDOW_MS) {
    // Window expired or first attempt — reset
    loginAttempts.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (record.count >= maxAttempts) {
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

// ─── POST /api/v1/auth/admin/change-password ────────────────────────
// Admin changes their OWN password. Id comes from the token — there is no
// :id param, so an admin can only ever change their own (no IDOR). Existing
// tokens stay valid after a change (JWT_SECRET is unchanged); a change does
// NOT revoke other sessions — documented gap, separate feature if needed.
const MIN_PASSWORD_LENGTH = 10;

router.post(
  "/admin/change-password",
  requireAdmin,
  async (req: AdminRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const adminId = req.admin!.adminId;

      if (
        !currentPassword ||
        !newPassword ||
        typeof currentPassword !== "string" ||
        typeof newPassword !== "string"
      ) {
        res.status(400).json({
          success: false,
          data: null,
          error: "currentPassword and newPassword are required",
        });
        return;
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 72) {
        // bcrypt silently truncates at 72 bytes — cap there to avoid surprises.
        res.status(400).json({
          success: false,
          data: null,
          error: `New password must be ${MIN_PASSWORD_LENGTH}–72 characters`,
        });
        return;
      }

      if (newPassword === currentPassword) {
        res.status(400).json({
          success: false,
          data: null,
          error: "New password must be different from the current password",
        });
        return;
      }

      // Rate limit wrong-current-password guesses per admin
      if (!checkRateLimit(`pwchange:${adminId}`)) {
        res.status(429).json({
          success: false,
          data: null,
          error: "Too many attempts. Try again in 15 minutes.",
        });
        return;
      }

      const admin = await prisma.admin.findUnique({ where: { id: adminId } });
      if (!admin) {
        res.status(404).json({
          success: false,
          data: null,
          error: "Admin not found",
        });
        return;
      }

      const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
      if (!valid) {
        res.status(401).json({
          success: false,
          data: null,
          error: "Current password is incorrect",
        });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.admin.update({
        where: { id: adminId },
        data: { passwordHash },
      });

      // Success clears the attempt counter
      resetRateLimit(`pwchange:${adminId}`);

      res.json({
        success: true,
        data: { message: "Password updated" },
      });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({
        success: false,
        data: null,
        error: "Internal server error",
      });
    }
  },
);

// ─── POST /api/v1/auth/admin/request-reset ──────────────────────────
// Forgot-password step 1. Always returns the same 200 whether or not the
// email exists (anti-enumeration) — failures are logged server-side only.
// Stores only the SHA-256 hash of the token; the raw token goes in the
// emailed link. Newest request wins: any prior token is overwritten.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESET_REQUEST_MAX_ATTEMPTS = 3; // it sends email — keep it tight

router.post("/admin/request-reset", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      res.status(400).json({
        success: false,
        data: null,
        error: "Email is required",
      });
      return;
    }

    const emailKey = `reset-req:${email.toLowerCase()}`;
    const ipKey = `reset-req-ip:${req.ip}`;
    if (
      !checkRateLimit(emailKey, RESET_REQUEST_MAX_ATTEMPTS) ||
      !checkRateLimit(ipKey)
    ) {
      res.status(429).json({
        success: false,
        data: null,
        error: "Too many reset requests. Try again in 15 minutes.",
      });
      return;
    }

    const admin = await prisma.admin.findUnique({ where: { email } });

    if (admin) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

      await prisma.admin.update({
        where: { id: admin.id },
        data: {
          resetTokenHash,
          resetTokenExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      // Fire-and-forget (never throws): awaiting the SendGrid call would make
      // known-email requests measurably slower than unknown ones — a timing
      // oracle for account enumeration.
      void sendPasswordResetEmail(admin.email, rawToken);
    }

    res.json({
      success: true,
      data: {
        message: "If that email has an account, a reset link has been sent.",
      },
    });
  } catch (err) {
    console.error("Request reset error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── POST /api/v1/auth/admin/reset-password ─────────────────────────
// Forgot-password step 2. Single-use: the token hash is nulled in the same
// update that writes the new password hash. Expired/used/unknown tokens all
// get the same generic 400. Like change-password, existing JWT sessions
// stay valid after a reset — documented gap, separate feature if needed.
router.post("/admin/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (
      !token ||
      !newPassword ||
      typeof token !== "string" ||
      typeof newPassword !== "string"
    ) {
      res.status(400).json({
        success: false,
        data: null,
        error: "token and newPassword are required",
      });
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 72) {
      // bcrypt silently truncates at 72 bytes — cap there to avoid surprises.
      res.status(400).json({
        success: false,
        data: null,
        error: `New password must be ${MIN_PASSWORD_LENGTH}–72 characters`,
      });
      return;
    }

    const ipKey = `reset-confirm-ip:${req.ip}`;
    if (!checkRateLimit(ipKey)) {
      res.status(429).json({
        success: false,
        data: null,
        error: "Too many attempts. Try again in 15 minutes.",
      });
      return;
    }

    const resetTokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const admin = await prisma.admin.findFirst({
      where: {
        resetTokenHash,
        resetTokenExpires: { gt: new Date() },
      },
    });

    if (!admin) {
      res.status(400).json({
        success: false,
        data: null,
        error: "Invalid or expired reset link",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        resetTokenHash: null,
        resetTokenExpires: null,
      },
    });

    resetRateLimit(ipKey);

    res.json({
      success: true,
      data: { message: "Password updated" },
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
