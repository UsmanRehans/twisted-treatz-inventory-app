import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();

// Bulk low-stock threshold maintenance via CSV: export every active product's
// alert threshold, edit new_threshold offline, re-import. Thresholds are
// CONFIGURATION (not stock), so a change is a plain field update — no
// Adjustment/audit row, matching the inline editor on the Products tab.
// Deliberately NO alert emails here: products that now sit at/below their new
// threshold are FLAGGED in the report so the admin sees them without a 50-email
// storm (the same choice the bulk-quantity import makes).

const MAX_ROWS = 1000;
const MAX_THRESHOLD = 1_000_000;

// Excel executes cells starting with = + - @ (or tab/CR) as formulas. Quote
// every text cell and neutralize formula triggers with a leading '.
function escapeCsvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  return `"${cell.replace(/"/g, '""')}"`;
}

// ─── GET /api/v1/thresholds/export ───────────────────────────────
// Admin only — snapshot of active products with their current threshold.
// new_threshold is the one editable column; current_qty is context so the
// admin can pick a sensible level relative to what's on hand.
router.get("/export", requireAdmin, async (_req: AdminRequest, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        category: true,
        currentQty: true,
        alertThreshold: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    const header = "id,item,category,current_qty,alert_threshold,new_threshold";
    const lines = products.map((p) =>
      [
        String(p.id),
        escapeCsvCell(p.name),
        escapeCsvCell(p.category),
        String(p.currentQty),
        String(p.alertThreshold),
        "", // new_threshold — the one editable column; blank = no change
      ].join(","),
    );

    // UTF-8 BOM + CRLF so Excel opens it cleanly
    const csv = "\uFEFF" + [header, ...lines].join("\r\n") + "\r\n";

    res.json({
      success: true,
      data: {
        csv,
        productCount: products.length,
        exportedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Threshold export error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

// ─── POST /api/v1/thresholds/import ──────────────────────────────
// Admin only — apply edited thresholds. Body:
//   { rows: [{ id, newThreshold }], dryRun?: boolean }
// newThreshold is the ABSOLUTE new alert level. Rows whose threshold is
// unchanged are no-ops; not-found/inactive ids are skipped and reported.
// Each update is a single field write (no audit row — config, not stock).
router.post("/import", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const { rows, dryRun } = req.body as { rows?: unknown; dryRun?: unknown };

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, data: null, error: "rows must be a non-empty array" });
      return;
    }
    if (rows.length > MAX_ROWS) {
      res.status(400).json({ success: false, data: null, error: `Too many rows (max ${MAX_ROWS})` });
      return;
    }

    const isDryRun = dryRun === true;

    type ParsedRow = { id: number; newThreshold: number };
    const parsed: ParsedRow[] = [];
    const skipped: { row: number; id: number | null; reason: string }[] = [];
    const seenIds = new Set<number>();

    rows.forEach((raw, i) => {
      const row = i + 1;
      const r = raw as Record<string, unknown>;
      const id = r.id;
      const newThreshold = r.newThreshold;

      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
        skipped.push({ row, id: null, reason: "id must be a positive integer" });
        return;
      }
      if (
        typeof newThreshold !== "number" ||
        !Number.isInteger(newThreshold) ||
        newThreshold < 0 ||
        newThreshold > MAX_THRESHOLD
      ) {
        skipped.push({
          row,
          id,
          reason: `new_threshold must be an integer between 0 and ${MAX_THRESHOLD}`,
        });
        return;
      }
      if (seenIds.has(id)) {
        skipped.push({ row, id, reason: "duplicate row for this product" });
        return;
      }
      seenIds.add(id);
      parsed.push({ id, newThreshold });
    });

    // One lookup for every referenced product
    const products = await prisma.product.findMany({
      where: { id: { in: parsed.map((p) => p.id) } },
      select: { id: true, name: true, currentQty: true, alertThreshold: true, active: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    type Change = {
      id: number;
      name: string;
      thresholdBefore: number;
      thresholdAfter: number;
      currentQty: number;
      belowThreshold: boolean; // current stock now sits at/below the new level
    };
    const changes: Change[] = [];
    let unchanged = 0;

    for (const rowData of parsed) {
      const row = rows.findIndex((r) => (r as Record<string, unknown>).id === rowData.id) + 1;
      const product = productById.get(rowData.id);
      if (!product || !product.active) {
        skipped.push({ row, id: rowData.id, reason: "Product not found or inactive" });
        continue;
      }
      if (rowData.newThreshold === product.alertThreshold) {
        unchanged++;
        continue;
      }
      changes.push({
        id: product.id,
        name: product.name,
        thresholdBefore: product.alertThreshold,
        thresholdAfter: rowData.newThreshold,
        currentQty: product.currentQty,
        belowThreshold: product.currentQty <= rowData.newThreshold,
      });
    }

    if (!isDryRun) {
      // Plain field updates — no audit row, no alert emails (see header note).
      for (const c of changes) {
        await prisma.product.update({
          where: { id: c.id },
          data: { alertThreshold: c.thresholdAfter },
        });
      }
    }

    res.status(isDryRun ? 200 : 201).json({
      success: true,
      data: {
        dryRun: isDryRun,
        applied: changes,
        skipped,
        summary: {
          changes: changes.length,
          unchanged,
          raised: changes.filter((c) => c.thresholdAfter > c.thresholdBefore).length,
          lowered: changes.filter((c) => c.thresholdAfter < c.thresholdBefore).length,
          belowThreshold: changes.filter((c) => c.belowThreshold).length,
          errors: skipped.length,
        },
      },
    });
  } catch (err) {
    console.error("Threshold import error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

export default router;
