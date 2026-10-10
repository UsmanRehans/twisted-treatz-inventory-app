// ─── The JSON envelope holds off the happy path too ──────────────────
// CLAUDE.md: "All responses: { success, data, error? }". Unknown routes and
// unparseable bodies used to fall through to Express's HTML defaults.

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createMockPrisma } from "./helpers/mockPrisma.js";

vi.mock("../src/lib/prisma.js", () => ({ prisma: createMockPrisma() }));
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() },
}));

import app from "../src/app.js";

describe("response envelope off the happy path", () => {
  it("returns a JSON 404 for an unknown path", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ success: false, data: null, error: "Not found" });
  });

  it("returns a JSON 404 for an unknown sub-path of a mounted router", async () => {
    const res = await request(app).get("/api/v1/products/1/nope");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.success).toBe(false);
  });

  it("returns a JSON 400 for a malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/admin/login")
      .set("Content-Type", "application/json")
      .send("{ not json");
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ success: false, data: null, error: "Malformed JSON body" });
  });

  it("leaves the health check untouched", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: "ok" } });
  });
});
