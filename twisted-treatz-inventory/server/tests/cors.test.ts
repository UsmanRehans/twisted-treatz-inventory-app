// ─── CORS origin pinning ────────────────────────────────────────────
// Only the production frontend (and local dev origins outside prod)
// may make browser cross-origin calls. Unknown origins get no
// Access-Control-Allow-Origin header; origin-less requests (curl,
// health probes) still work.

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";

describe("CORS pinning", () => {
  it("allows the production frontend origin", async () => {
    const res = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://inventory.twistedtreatz.com");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://inventory.twistedtreatz.com",
    );
  });

  it("allows the local dev origin outside production", async () => {
    const res = await request(app)
      .get("/api/v1/health")
      .set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });

  it("does not allow unknown origins", async () => {
    const res = await request(app)
      .get("/api/v1/health")
      .set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still serves requests without an Origin header", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
