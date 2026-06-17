import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken, AdminPayload } from "../services/tokenService.js";

export interface AdminRequest extends Request {
  admin?: AdminPayload;
}

// Session revocation: an admin token is only valid while its tokenVersion
// claim matches the DB. Password change/reset bumps the DB value, evicting
// every previously issued token. Tokens minted before the claim existed
// count as version 0. Shared by requireAdmin and requireAnyAuth so the two
// can't drift.
export async function adminTokenVersionValid(payload: AdminPayload): Promise<boolean> {
  const admin = await prisma.admin.findUnique({
    where: { id: payload.adminId },
    select: { tokenVersion: true },
  });
  if (!admin) return false;
  return (payload.tokenVersion ?? 0) === admin.tokenVersion;
}

export async function requireAdmin(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      data: null,
      error: "Missing or invalid authorization header",
    });
    return;
  }

  const token = authHeader.slice(7);

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({
      success: false,
      data: null,
      error: "Invalid or expired token",
    });
    return;
  }

  if (payload.type !== "admin") {
    res.status(403).json({
      success: false,
      data: null,
      error: "Admin access required",
    });
    return;
  }

  try {
    if (!(await adminTokenVersionValid(payload))) {
      res.status(401).json({
        success: false,
        data: null,
        error: "Invalid or expired token",
      });
      return;
    }
  } catch (err) {
    console.error("Admin token version check error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
    return;
  }

  req.admin = payload;
  next();
}
