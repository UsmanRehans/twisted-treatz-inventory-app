import { Request, Response, NextFunction } from "express";
import { verifyToken, TeamMemberPayload } from "../services/tokenService.js";

export interface TeamMemberRequest extends Request {
  teamMember?: TeamMemberPayload;
}

export function requireTeamMember(req: TeamMemberRequest, res: Response, next: NextFunction): void {
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

    if (payload.type !== "team") {
      res.status(403).json({
        success: false,
        data: null,
        error: "Team member access required",
      });
      return;
    }

    req.teamMember = payload;
    next();
  } catch {
    res.status(401).json({
      success: false,
      data: null,
      error: "Invalid or expired token",
    });
  }
}
