import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "twisted-treatz-jwt-secret-2024-change-in-production";

export interface AdminPayload {
  type: "admin";
  adminId: number;
  email: string;
}

export interface TeamMemberPayload {
  type: "team";
  memberId: number;
  name: string;
  initials: string;
}

export type TokenPayload = AdminPayload | TeamMemberPayload;

export function generateAdminToken(admin: { id: number; email: string }): string {
  const payload: AdminPayload = {
    type: "admin",
    adminId: admin.id,
    email: admin.email,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function generateTeamMemberToken(member: {
  id: number;
  name: string;
  initials: string;
}): string {
  const payload: TeamMemberPayload = {
    type: "team",
    memberId: member.id,
    name: member.name,
    initials: member.initials,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
