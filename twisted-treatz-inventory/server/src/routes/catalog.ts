import { Router, Response } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";
import { normalizeBrandName } from "../lib/brand.js";
import { normalizeUom, parsePackSize } from "../lib/measure.js";

const router = Router();

// ─── Catalog import ──────────────────────────────────────────────────
// Ingests Hani's master inventory sheet (Item, Category, Qty, Pack Size,
// UOM, Brand) — the catalog counterpart to the quantity-only round-trip in
// adjustments.ts. Matches existing products BY NAME (the sheet has no id),
// creates the ones we don't have, and updates catalog fields on the ones we
// do. Quantity changes still flow through an Adjustment record so the audit
// trail stays truthful and the "stock only moves with an audit row"
// invariant holds. Always preview (dryRun) before apply; nothing in here
// is fired without the admin seeing the plan first.

const MAX_ROWS = 2000;
const MAX_QTY = 1_000_000;

// Hani leaves a cell blank → per the agreed rule, an empty Qty counts as 0
// and the row is FLAGGED so Hani can fill the real value in the admin panel.
// Empty Brand/Pack Size/UOM can't be "zero" (you can't have 0 lb), so they
// stay null and are likewise flagged — never silently invented.
type MissingField = "qty" | "packSize" | "uom" | "brand";

type ParsedRow = {
  item: string;
  category: string | null;
  brandName: string | null;
  packSize: number | null;
  uom: string | null;
  qty: number; // empty → 0
  missing: MissingField[];
};

function lc(s: string): string {
  return s.trim().toLowerCase();
}

router.post("/import", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const { rows, dryRun } = req.body as { rows?: unknown; dryRun?: unknown };
    const adminId = req.admin!.adminId;
    const isDryRun = dryRun === true;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, data: null, error: "rows must be a non-empty array" });
      return;
    }
    if (rows.length > MAX_ROWS) {
      res.status(400).json({ success: false, data: null, error: `Too many rows (max ${MAX_ROWS})` });
      return;
    }

    const parsed: ParsedRow[] = [];
    const skipped: { row: number; item: string | null; reason: string }[] = [];
    const seenNames = new Set<string>();

    rows.forEach((raw, i) => {
      const rowNum = i + 1;
      const r = (raw ?? {}) as Record<string, unknown>;

      const itemRaw = typeof r.item === "string" ? r.item.trim() : "";
      if (itemRaw === "") {
        skipped.push({ row: rowNum, item: null, reason: "item (name) is required" });
        return;
      }
      if (seenNames.has(lc(itemRaw))) {
        skipped.push({ row: rowNum, item: itemRaw, reason: "duplicate item in file" });
        return;
      }

      const missing: MissingField[] = [];

      const category =
        typeof r.category === "string" && r.category.trim() !== "" ? r.category.trim() : null;

      const brandRaw = r.brand;
      const brandName = normalizeBrandName(typeof brandRaw === "string" ? brandRaw : null);
      if (!brandName) missing.push("brand");

      const packParsed = parsePackSize(r.packSize);
      if (!packParsed.ok) {
        skipped.push({ row: rowNum, item: itemRaw, reason: packParsed.reason });
        return;
      }
      if (packParsed.value === null) missing.push("packSize");

      const uom = normalizeUom(r.uom);
      if (!uom) missing.push("uom");

      // qty: empty → 0 (flagged). Present must be a non-negative integer.
      let qty = 0;
      const qtyRaw = r.qty;
      if (qtyRaw == null || qtyRaw === "") {
        missing.push("qty");
      } else {
        const n = typeof qtyRaw === "number" ? qtyRaw : Number(String(qtyRaw).trim());
        if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) {
          skipped.push({
            row: rowNum,
            item: itemRaw,
            reason: `qty must be an integer between 0 and ${MAX_QTY}`,
          });
          return;
        }
        qty = n;
      }

      seenNames.add(lc(itemRaw));
      parsed.push({ item: itemRaw, category, brandName, packSize: packParsed.value, uom, qty, missing });
    });

    // One load of every active product, indexed by lowercased name.
    const existing = await prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        category: true,
        brandId: true,
        packSize: true,
        uom: true,
        currentQty: true,
      },
    });
    const byName = new Map(existing.map((p) => [lc(p.name), p]));

    // Resolve brands referenced in the file to ids; collect the ones we'd
    // have to create. In a dry run we never write — we just report them.
    const brandNames = [...new Set(parsed.map((p) => p.brandName).filter((b): b is string => !!b))];
    const existingBrands = await prisma.brand.findMany({
      where: { name: { in: brandNames } },
      select: { id: true, name: true },
    });
    const brandIdByName = new Map(existingBrands.map((b) => [b.name, b.id]));
    const brandsToCreate = brandNames.filter((n) => !brandIdByName.has(n));

    type Create = {
      item: string;
      category: string | null;
      brand: string | null;
      packSize: number | null;
      uom: string | null;
      qty: number;
      missing: MissingField[];
    };
    type FieldChange = { from: unknown; to: unknown };
    type Update = {
      id: number;
      item: string;
      changes: Record<string, FieldChange>;
      qtyBefore: number;
      qtyAfter: number;
      qtyDelta: number;
    };

    const creates: Create[] = [];
    const updates: Update[] = [];
    const flagged: { item: string; missing: MissingField[] }[] = [];
    let unchanged = 0;
    let zeroed = 0;

    for (const p of parsed) {
      if (p.missing.length > 0) flagged.push({ item: p.item, missing: p.missing });

      const match = byName.get(lc(p.item));
      if (!match) {
        creates.push({
          item: p.item,
          category: p.category,
          brand: p.brandName,
          packSize: p.packSize,
          uom: p.uom,
          qty: p.qty,
          missing: p.missing,
        });
        if (p.qty === 0) zeroed++; // new product lands at 0
        continue;
      }

      // Existing product — compute catalog field diffs (only for provided
      // values; a blank cell never overwrites an existing value, except qty
      // which follows the agreed empty→0 rule).
      const changes: Record<string, FieldChange> = {};
      if (p.category && p.category !== match.category) {
        changes.category = { from: match.category, to: p.category };
      }
      if (p.brandName) {
        const targetBrandId = brandIdByName.get(p.brandName) ?? "(new)";
        if (targetBrandId !== match.brandId) {
          changes.brand = { from: match.brandId, to: p.brandName };
        }
      }
      if (p.packSize !== null) {
        const cur = match.packSize !== null ? Number(match.packSize) : null;
        if (p.packSize !== cur) changes.packSize = { from: cur, to: p.packSize };
      }
      if (p.uom && p.uom !== match.uom) {
        changes.uom = { from: match.uom, to: p.uom };
      }

      const qtyDelta = p.qty - match.currentQty;
      if (qtyDelta !== 0 && p.qty === 0) zeroed++;

      if (Object.keys(changes).length === 0 && qtyDelta === 0) {
        unchanged++;
        continue;
      }

      updates.push({
        id: match.id,
        item: match.name,
        changes,
        qtyBefore: match.currentQty,
        qtyAfter: p.qty,
        qtyDelta,
      });
    }

    const batchId = isDryRun ? null : randomUUID();

    if (!isDryRun) {
      // 1. Create missing brands, fill the id map.
      for (const name of brandsToCreate) {
        const created = await prisma.brand.upsert({
          where: { name },
          update: {},
          create: { name },
          select: { id: true, name: true },
        });
        brandIdByName.set(created.name, created.id);
      }

      // 2. Create new products at qty 0, then (if counted >0) one Adjustment
      //    that moves 0→qty so the count has an audit row.
      for (const c of creates) {
        const created = await prisma.product.create({
          data: {
            name: c.item,
            category: c.category ?? "Uncategorized",
            purchaseUnit: "Each", // required field; admin can refine later
            packSize: c.packSize,
            uom: c.uom,
            brandId: c.brand ? (brandIdByName.get(c.brand) ?? null) : null,
            currentQty: 0, // ← invariant: products are born empty
          },
          select: { id: true },
        });
        if (c.qty > 0) {
          await prisma.$transaction([
            prisma.product.update({ where: { id: created.id }, data: { currentQty: c.qty } }),
            prisma.adjustment.create({
              data: {
                productId: created.id,
                adminId,
                delta: c.qty,
                qtyBefore: 0,
                qtyAfter: c.qty,
                reason: "Catalog import (initial count)",
                batchId: batchId!,
              },
            }),
          ]);
        }
      }

      // 3. Apply updates. Catalog fields are a plain update; a qty change is
      //    paired with an Adjustment in the same transaction.
      for (const u of updates) {
        const data: Record<string, unknown> = {};
        if ("category" in u.changes) data.category = u.changes.category.to;
        if ("packSize" in u.changes) data.packSize = u.changes.packSize.to;
        if ("uom" in u.changes) data.uom = u.changes.uom.to;
        if ("brand" in u.changes) {
          const bn = u.changes.brand.to as string;
          data.brandId = brandIdByName.get(bn) ?? null;
        }
        if (u.qtyDelta !== 0) data.currentQty = u.qtyAfter;

        await prisma.$transaction([
          prisma.product.update({ where: { id: u.id }, data }),
          ...(u.qtyDelta !== 0
            ? [
                prisma.adjustment.create({
                  data: {
                    productId: u.id,
                    adminId,
                    delta: u.qtyDelta,
                    qtyBefore: u.qtyBefore,
                    qtyAfter: u.qtyAfter,
                    reason: "Catalog import",
                    batchId: batchId!,
                  },
                }),
              ]
            : []),
        ]);
      }
    }

    res.status(isDryRun ? 200 : 201).json({
      success: true,
      data: {
        dryRun: isDryRun,
        batchId,
        creates,
        updates,
        brandsToCreate,
        flagged,
        skipped,
        unchanged,
        summary: {
          creates: creates.length,
          updates: updates.length,
          qtyChanges: updates.filter((u) => u.qtyDelta !== 0).length,
          zeroed,
          brandsToCreate: brandsToCreate.length,
          flagged: flagged.length,
          unchanged,
          errors: skipped.length,
        },
      },
    });
  } catch (err) {
    console.error("Catalog import error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

export default router;
