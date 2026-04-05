import { Request, Response, NextFunction } from "express";
import { verifyToken, AdminPayload } from "../services/tokenService.js";

export interface AdminRequest extends Request {
  admin?: AdminPayload;
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
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

    if (payload.type !== "admin") {
      res.status(403).json({
        success: false,
        data: null,
        error: "Admin access required",
      });
      return;
    }

    req.admin = payload;
    next();
  } catch {
    res.status(401).json({
      success: false,
      data: null,
      error: "Invalid or expired token",
    });
  }
}
