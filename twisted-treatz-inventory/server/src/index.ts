import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import teamMembersRoutes from "./routes/teamMembers.js";
import productsRoutes from "./routes/products.js";
import adminStatsRoutes from "./routes/adminStats.js";
import removalsRoutes from "./routes/removals.js";
import receiptsRoutes from "./routes/receipts.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Routes ─────────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/team-members", teamMembersRoutes);
app.use("/api/v1/products", productsRoutes);
app.use("/api/v1/admin", adminStatsRoutes);
app.use("/api/v1/removals", removalsRoutes);
app.use("/api/v1/receipts", receiptsRoutes);

// ─── Health check ───────────────────────────────────────────────────
app.get("/api/v1/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" } });
});

// ─── Start server ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Twisted Treatz API server running on port ${PORT}`);
});

export default app;
