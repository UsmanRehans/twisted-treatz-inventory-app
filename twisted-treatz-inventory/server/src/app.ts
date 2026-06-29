import express from "express";
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
app.use(cors());
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

export default app;
