import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import teamMembersRoutes from "./routes/teamMembers.js";
import productsRoutes from "./routes/products.js";
import brandsRoutes from "./routes/brands.js";
import adminStatsRoutes from "./routes/adminStats.js";
import removalsRoutes from "./routes/removals.js";
import receiptsRoutes from "./routes/receipts.js";
import adjustmentsRoutes from "./routes/adjustments.js";
import catalogRoutes from "./routes/catalog.js";
import thresholdsRoutes from "./routes/thresholds.js";

// App construction lives here (separate from index.ts which calls listen)
// so tests can import the app and drive it with supertest.
const app = express();

// Behind Railway's proxy — trust the first hop so req.ip is the real
// client address. Without this, IP-keyed rate limiting buckets every
// request under the proxy IP, letting one scanner lock out all logins.
app.set("trust proxy", 1);

// ─── Middleware ──────────────────────────────────────────────────────
// CORS is pinned to the production frontend plus local dev origins.
// Requests without an Origin header (curl, health checks, the Railway
// probe) are unaffected — this only gates what browsers will accept.
// CORS_EXTRA_ORIGINS (comma-separated) can whitelist extra origins,
// e.g. a Vercel preview URL, without a code change.
const allowedOrigins = [
  "https://inventory.twistedtreatz.com",
  ...(process.env.NODE_ENV !== "production"
    ? ["http://localhost:5173", "http://localhost:4173"]
    : []),
  ...(process.env.CORS_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// ─── Routes ─────────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/team-members", teamMembersRoutes);
app.use("/api/v1/products", productsRoutes);
app.use("/api/v1/brands", brandsRoutes);
app.use("/api/v1/admin", adminStatsRoutes);
app.use("/api/v1/removals", removalsRoutes);
app.use("/api/v1/receipts", receiptsRoutes);
app.use("/api/v1/adjustments", adjustmentsRoutes);
app.use("/api/v1/catalog", catalogRoutes);
app.use("/api/v1/thresholds", thresholdsRoutes);

// ─── Health check ───────────────────────────────────────────────────
app.get("/api/v1/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" } });
});

// ─── Fallbacks: keep the JSON envelope off the happy path ────────────
// Without these an unknown path or a malformed JSON body came back as an
// Express HTML page, which the clients then failed to JSON-parse.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, data: null, error: "Not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { type?: string; status?: number; statusCode?: number };
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ success: false, data: null, error: "Malformed JSON body" });
    return;
  }
  if (e?.type === "entity.too.large") {
    res.status(413).json({ success: false, data: null, error: "Request body too large" });
    return;
  }
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ success: false, data: null, error: "Bad request" });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, data: null, error: "Internal server error" });
});

export default app;
