import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();

// Bulk stock correction via CSV: export the catalog, edit new_qty offline,
// re-import. Each applied row writes an Adjustment (the admin counterpart
// of Removal/Receipt) in the same transaction as the qty update.

const MAX_ROWS = 1000;
const MAX_QTY = 1_000_000;
const MAX_NOTE_LENGTH = 500;

// Excel executes cells starting with = + - @ (or tab/CR) as formulas.
// Quote every text cell and neutralize formula triggers with a leading '.
function escapeCsvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  return `"${cell.replace(/"/g, '""')}"`;
}

// ─── GET /api/v1/adjustments/export ──────────────────────────────
// Admin only — snapshot of active products as an editable CSV.
// current_qty doubles as the staleness marker on re-import.
router.get("/export", requireAdmin, async (_req: AdminRequest, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        category: true,
        purchaseUnit: true,
        unitSize: true,
        currentQty: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    const header = "id,name,category,purchase_unit,unit_size,current_qty,new_qty,note";
    const lines = products.map((p) =>
      [
        String(p.id),
        escapeCsvCell(p.name),
        escapeCsvCell(p.category),
        escapeCsvCell(p.purchaseUnit),
        escapeCsvCell(p.unitSize ?? ""),
        String(p.currentQty),
        "", // new_qty — the one editable column; blank = no change
        "", // note — optional, lands in Adjustment.reason
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
    console.error("Adjustment export error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

// ─── POST /api/v1/adjustments/import ─────────────────────────────
// Admin only — apply edited CSV rows. Body:
//   { rows: [{ id, newQty, csvQty?, note? }], dryRun?: boolean }
// newQty is the ABSOLUTE counted quantity; the server computes the delta
// against the LIVE qty so the audit trail stays truthful even when the
// floor moved stock during the edit window (those rows are flagged as
// conflicts but still applied — the admin's count wins).
// Per-row apply with a full report: one bad row never blocks the rest.
router.post("/import", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const { rows, dryRun } = req.body as {
      rows?: unknown;
      dryRun?: unknown;
    };
    const adminId = req.admin!.adminId;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({
        success: false,
        data: null,
        error: "rows must be a non-empty array",
      });
      return;
    }

    if (rows.length > MAX_ROWS) {
      res.status(400).json({
        success: false,
        data: null,
        error: `Too many rows (max ${MAX_ROWS})`,
      });
      return;
    }

    const isDryRun = dryRun === true;

    type ParsedRow = { id: number; newQty: number; csvQty: number | null; note: string | null };
    const parsed: ParsedRow[] = [];
    const skipped: { row: number; id: number | null; reason: string }[] = [];
    const seenIds = new Set<number>();

    rows.forEach((raw, i) => {
      const row = i + 1;
      const r = raw as Record<string, unknown>;
      const id = r.id;
      const newQty = r.newQty;

      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
        skipped.push({ row, id: null, reason: "id must be a positive integer" });
        return;
      }
      if (
        typeof newQty !== "number" ||
        !Number.isInteger(newQty) ||
        newQty < 0 ||
        newQty > MAX_QTY
      ) {
        skipped.push({ row, id, reason: `new_qty must be an integer between 0 and ${MAX_QTY}` });
        return;
      }
      if (seenIds.has(id)) {
        skipped.push({ row, id, reason: "duplicate row for this product" });
        return;
      }
      seenIds.add(id);

      const csvQty =
        typeof r.csvQty === "number" && Number.isInteger(r.csvQty) ? r.csvQty : null;
      const note =
        typeof r.note === "string" && r.note.trim() !== ""
          ? r.note.trim().slice(0, MAX_NOTE_LENGTH)
          : null;

      parsed.push({ id, newQty, csvQty, note });
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
      qtyBefore: number;
      newQty: number;
      delta: number;
      conflict: boolean; // stock moved between export and import
      belowThreshold: boolean;
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

      const delta = rowData.newQty - product.currentQty;
      if (delta === 0) {
        unchanged++;
        continue;
      }

      changes.push({
        id: product.id,
        name: product.name,
        qtyBefore: product.currentQty,
        newQty: rowData.newQty,
        delta,
        conflict: rowData.csvQty !== null && rowData.csvQty !== product.currentQty,
        belowThreshold: rowData.newQty <= product.alertThreshold,
      });
    }

    const batchId = isDryRun ? null : randomUUID();

    if (!isDryRun) {
      // Per-row atomicity: qty update + Adjustment record commit together.
      // Deliberately NO low-stock emails here — the admin is the alert
      // recipient and is looking at the report; belowThreshold flags the
      // same products without a 50-email storm.
      const noteById = new Map(parsed.map((p) => [p.id, p.note]));
      for (const c of changes) {
        await prisma.$transaction([
          prisma.product.update({
            where: { id: c.id },
            data: { currentQty: c.newQty },
          }),
          prisma.adjustment.create({
            data: {
              productId: c.id,
              adminId,
              delta: c.delta,
              qtyBefore: c.qtyBefore,
              qtyAfter: c.newQty,
              reason: noteById.get(c.id) ?? null,
              batchId: batchId!,
            },
          }),
        ]);
      }
    }

    res.status(isDryRun ? 200 : 201).json({
      success: true,
      data: {
        dryRun: isDryRun,
        batchId,
        applied: changes.map((c) => ({
          id: c.id,
          name: c.name,
          qtyBefore: c.qtyBefore,
          qtyAfter: c.newQty,
          delta: c.delta,
          conflict: c.conflict,
          belowThreshold: c.belowThreshold,
        })),
        skipped,
        summary: {
          changes: changes.length,
          unchanged,
          added: changes.filter((c) => c.delta > 0).reduce((s, c) => s + c.delta, 0),
          removed: changes.filter((c) => c.delta < 0).reduce((s, c) => s - c.delta, 0),
          zeroed: changes.filter((c) => c.newQty === 0).length,
          conflicts: changes.filter((c) => c.conflict).length,
          belowThreshold: changes.filter((c) => c.belowThreshold).length,
          errors: skipped.length,
        },
      },
    });
  } catch (err) {
    console.error("Adjustment import error:", err);
    res.status(500).json({
      success: false,
      data: null,
      error: "Internal server error",
    });
  }
});

export default router;
