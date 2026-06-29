// ─── Prisma mock for tests ──────────────────────────────────────────
// The app imports a single shared client from src/lib/prisma.ts, so
// mocking that one module puts the entire API under test control.
// Each test file calls vi.mock("../src/lib/prisma.js", ...) with this.

import { vi } from "vitest";

export function createMockPrisma() {
  return {
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    brand: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    teamMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    admin: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    removal: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    receipt: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    adjustment: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    alertLog: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    // Array form: run all queued promises. Routes only use this form.
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    $queryRaw: vi.fn(),
  };
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
