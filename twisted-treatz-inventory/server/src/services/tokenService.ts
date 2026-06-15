import jwt from "jsonwebtoken";

// A real secret is mandatory unless explicitly running in dev/test. The
// fallback is gated behind ALLOW_DEV_SECRET so a misconfigured NODE_ENV
// can never silently let the public fallback secret sign real tokens —
// that would let anyone forge admin tokens.
const allowDevSecret =
  process.env.ALLOW_DEV_SECRET === "true" || process.env.NODE_ENV === "test";

if (!process.env.JWT_SECRET && !allowDevSecret) {
  throw new Error(
    "JWT_SECRET environment variable must be set (or set ALLOW_DEV_SECRET=true for local dev)",
  );
}

const JWT_SECRET = process.env.JWT_SECRET || "twisted-treatz-dev-only-secret";

export interface AdminPayload {
  type: "admin";
  adminId: number;
  email: string;
  // Matched against Admin.tokenVersion on every admin-authed request so a
  // password change/reset evicts outstanding tokens. Optional because tokens
  // minted before this claim existed are still valid — they count as 0.
  tokenVersion?: number;
}

export interface TeamMemberPayload {
  type: "team";
  memberId: number;
  name: string;
  initials: string;
}

export type TokenPayload = AdminPayload | TeamMemberPayload;

export function generateAdminToken(admin: {
  id: number;
  email: string;
  tokenVersion: number;
}): string {
  const payload: AdminPayload = {
    type: "admin",
    adminId: admin.id,
    email: admin.email,
    tokenVersion: admin.tokenVersion,
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
