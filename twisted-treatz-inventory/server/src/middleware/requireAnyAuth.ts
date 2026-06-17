import { Request, Response, NextFunction } from "express";
import { verifyToken, AdminPayload, TeamMemberPayload } from "../services/tokenService.js";
import { adminTokenVersionValid } from "./requireAdmin.js";

export interface AuthedRequest extends Request {
  admin?: AdminPayload;
  teamMember?: TeamMemberPayload;
}

// Accepts EITHER a valid admin token or a valid team member token.
// Used for read endpoints both roles need (activity log, product browse).
// Admin tokens get the same tokenVersion check as requireAdmin — a revoked
// session shouldn't keep read access for the rest of its 24h TTL.
export async function requireAnyAuth(
  req: AuthedRequest,
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

  if (payload.type === "admin") {
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
  } else if (payload.type === "team") {
    req.teamMember = payload;
  } else {
    res.status(403).json({
      success: false,
      data: null,
      error: "Invalid token type",
    });
    return;
  }

  next();
}
