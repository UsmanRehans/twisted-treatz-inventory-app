// ─── Shared Prisma Client ────────────────────────────────────────────
// Single PrismaClient instance for the whole server. Import this instead
// of instantiating PrismaClient per file — keeps the connection pool sane
// and gives tests a single module to mock.

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
