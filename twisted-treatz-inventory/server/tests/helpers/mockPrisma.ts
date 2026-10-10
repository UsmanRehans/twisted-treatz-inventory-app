// ─── Prisma mock for tests ──────────────────────────────────────────
// The app imports a single shared client from src/lib/prisma.ts, so
// mocking that one module puts the entire API under test control.
// Each test file calls vi.mock("../src/lib/prisma.js", ...) with this.

import { vi } from "vitest";

export function createMockPrisma() {
  const mock = {
    product: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
      findUnique: vi.fn(),
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
    // Array form runs all queued promises; callback form (interactive
    // transaction) runs the callback with this same mock as the tx client.
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  mock.$transaction.mockImplementation(
    (arg: Promise<unknown>[] | ((tx: typeof mock) => Promise<unknown>)) =>
      typeof arg === "function" ? arg(mock) : Promise.all(arg),
  );
  return mock;
}

export type MockPrisma = ReturnType<typeof createMockPrisma>;
