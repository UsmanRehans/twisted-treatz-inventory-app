import app from "./app.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// ─── Start server ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Twisted Treatz API server running on port ${PORT}`);
});

export default app;
