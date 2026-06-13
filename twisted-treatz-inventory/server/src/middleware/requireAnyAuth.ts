import { Request, Response, NextFunction } from "express";
import { verifyToken, AdminPayload, TeamMemberPayload } from "../services/tokenService.js";

export interface AuthedRequest extends Request {
  admin?: AdminPayload;
  teamMember?: TeamMemberPayload;
}

// Accepts EITHER a valid admin token or a valid team member token.
// Used for read endpoints both roles need (activity log, product browse).
export function requireAnyAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
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

  try {
    const payload = verifyToken(token);

    if (payload.type === "admin") {
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
  } catch {
    res.status(401).json({
      success: false,
      data: null,
      error: "Invalid or expired token",
    });
  }
}
