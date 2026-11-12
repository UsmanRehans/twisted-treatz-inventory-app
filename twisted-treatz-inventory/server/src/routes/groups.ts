import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, AdminRequest } from "../middleware/requireAdmin.js";

const router = Router();

// ─── Product grouping (variations) ───────────────────────────────────
// Round-trip for the "Product Grouping" sheet: Hani folds flavors/sizes
// under one parent item ("Jelly Beans" over 37 flavor Products) by filling
// Group + Variation columns next to each product. This route exports that
// sheet and imports it back. Grouping is display-only — stock, thresholds
// and audit rows stay on the per-flavor Product — with ONE exception: a
// Discontinued "X" sets Product.active=false (the app's only "gone" flag).
// Import matches rows by Product ID (the sheet carries it), never by name.
// Unlike the catalog sheet, a blank Group is MEANINGFUL: the sheet is the
// whole grouping state, so blank = this product stands on its own.
// Always preview (dryRun) before apply.

const MAX_ROWS = 2000;
const MAX_NAME = 200;

function lc(s: string): string {
  return s.trim().toLowerCase();
}

// Excel executes cells starting with = + - @ (or tab/CR) as formulas. Quote
// every text cell and neutralize formula triggers (mirrors catalog.ts).
function escapeCsvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  return `"${cell.replace(/"/g, '""')}"`;
}

// ─── GET /api/v1/groups/export ───────────────────────────────────────
// Admin only — the Grouping sheet's Products tab as CSV: one row per active
// product with its current Group/Variation plus read-only context columns.
// The importer reads back ID, Group, Variation and Discontinued; everything
// else is there so the sheet is readable on its own.
router.get("/export", requireAdmin, async (_req: AdminRequest, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        category: true,
        variant: true,
        group: { select: { name: true } },
        brand: { select: { name: true } },
        packSize: true,
        uom: true,
        currentQty: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    const header = "ID,Product name,Group,Variation,Discontinued? (X),Category,Brand,Pack size,Qty on hand";
    const lines = products.map((p) =>
      [
        String(p.id),
        escapeCsvCell(p.name),
        escapeCsvCell(p.group?.name ?? ""),
        escapeCsvCell(p.variant ?? ""),
        "", // Discontinued is write-only: always blank on export
        escapeCsvCell(p.category),
        escapeCsvCell(p.brand?.name ?? ""),
        p.packSize != null ? `${escapeCsvCell(`${Number(p.packSize)}${p.uom ? ` ${p.uom}` : ""}`)}` : '""',
        String(p.currentQty),
      ].join(","),
    );

    const csv = "﻿" + [header, ...lines].join("\r\n") + "\r\n";

    res.json({
      success: true,
      data: { csv, productCount: products.length, exportedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error("Grouping export error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

// ─── POST /api/v1/groups/import ──────────────────────────────────────
// Body: {
//   rows:   [{ id, group?, variation?, discontinued? }, ...]   (Products tab)
//   groups: [{ group, category?, variantLabel? }, ...]          (Groups tab, optional)
//   dryRun: boolean
// }
// Semantics:
// - Row matched by Product ID; unknown or duplicate IDs are skipped.
// - group blank/null → product leaves its group (groupId+variant cleared).
// - variation without a group is a mistake → skipped, never half-applied.
// - discontinued: any non-blank cell counts as the X → active=false.
//   One-way: a blank NEVER reactivates (that stays a deliberate UI click).
//   Deactivation touches no quantity and writes no movement record.
// - groups[] metadata: variantLabel ("Type of variation") updates the group's
//   picker heading; category ("Category to use") is applied to every product
//   put in that group, so a group can't straddle categories in the menu.
//   NOTE: this means groups import and catalog import both write
//   Product.category — last write wins, which is fine at this scale.
// - After apply, groups left with no products are deleted.
router.post("/import", requireAdmin, async (req: AdminRequest, res: Response) => {
  try {
    const { rows, groups, dryRun } = req.body as {
      rows?: unknown;
      groups?: unknown;
      dryRun?: unknown;
    };
    // Fail-safe: dry-run-first means an ambiguous request must never apply.
    if (typeof dryRun !== "boolean") {
      res.status(400).json({ success: false, data: null, error: "dryRun must be a boolean" });
      return;
    }
    const isDryRun = dryRun;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, data: null, error: "rows must be a non-empty array" });
      return;
    }
    if (rows.length > MAX_ROWS) {
      res.status(400).json({ success: false, data: null, error: `Too many rows (max ${MAX_ROWS})` });
      return;
    }
    if (groups !== undefined && !Array.isArray(groups)) {
      res.status(400).json({ success: false, data: null, error: "groups must be an array" });
      return;
    }

    // ── Parse the Groups-tab metadata (keyed by lowercased group name) ──
    type GroupMeta = { name: string; category: string | null; variantLabel: string | null };
    const metaByName = new Map<string, GroupMeta>();
    for (const raw of (groups ?? []) as unknown[]) {
      const g = (raw ?? {}) as Record<string, unknown>;
      const name = typeof g.group === "string" ? g.group.trim() : "";
      if (!name || name.length > MAX_NAME) continue;
      const categoryRaw =
        typeof g.category === "string" && g.category.trim() !== "" ? g.category.trim() : null;
      if (categoryRaw && categoryRaw.length > MAX_NAME) continue; // oversized metadata: ignore the row
      const category = categoryRaw;
      const variantLabel =
        typeof g.variantLabel === "string" && g.variantLabel.trim() !== ""
          ? g.variantLabel.trim().slice(0, 50)
          : null;
      metaByName.set(lc(name), { name, category, variantLabel });
    }

    // ── Parse product rows ──
    type ParsedRow = {
      id: number;
      groupName: string | null; // null = stands alone
      variant: string | null;
      discontinued: boolean;
    };
    const parsed: ParsedRow[] = [];
    const skipped: { row: number; id: number | null; reason: string }[] = [];
    const seenIds = new Set<number>();

    (rows as unknown[]).forEach((raw, i) => {
      const rowNum = i + 1;
      const r = (raw ?? {}) as Record<string, unknown>;

      const idNum = typeof r.id === "number" ? r.id : Number(String(r.id ?? "").trim());
      if (!Number.isInteger(idNum) || idNum <= 0) {
        skipped.push({ row: rowNum, id: null, reason: "ID must be a positive integer" });
        return;
      }
      if (seenIds.has(idNum)) {
        skipped.push({ row: rowNum, id: idNum, reason: "duplicate ID in file" });
        return;
      }

      const groupName =
        typeof r.group === "string" && r.group.trim() !== "" ? r.group.trim() : null;
      if (groupName && groupName.length > MAX_NAME) {
        skipped.push({ row: rowNum, id: idNum, reason: `group must be at most ${MAX_NAME} characters` });
        return;
      }

      const variant =
        typeof r.variation === "string" && r.variation.trim() !== "" ? r.variation.trim() : null;
      if (variant && variant.length > MAX_NAME) {
        skipped.push({ row: rowNum, id: idNum, reason: `variation must be at most ${MAX_NAME} characters` });
        return;
      }
      if (variant && !groupName) {
        skipped.push({ row: rowNum, id: idNum, reason: "variation given without a group" });
        return;
      }

      const discontinued = String(r.discontinued ?? "").trim() !== "";

      seenIds.add(idNum);
      parsed.push({ id: idNum, groupName, variant, discontinued });
    });

    // ── Load current state ──
    const products = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        active: true,
        currentQty: true,
        variant: true,
        group: { select: { id: true, name: true } },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const existingGroups = await prisma.productGroup.findMany({
      select: { id: true, name: true, variantLabel: true },
    });
    const groupByLcName = new Map(existingGroups.map((g) => [lc(g.name), g]));

    // ── Plan the changes ──
    type GroupChange = {
      id: number;
      item: string;
      fromGroup: string | null;
      toGroup: string | null;
      fromVariant: string | null;
      toVariant: string | null;
    };
    type Deactivation = { id: number; item: string; qtyOnHand: number };
    type CategoryChange = { id: number; item: string; from: string; to: string };

    const groupChanges: GroupChange[] = [];
    const deactivations: Deactivation[] = [];
    const categoryChanges: CategoryChange[] = [];
    const newGroupNames: string[] = []; // first-seen casing from the sheet
    const seenNewGroups = new Set<string>();
    let unchanged = 0;

    for (const row of parsed) {
      const match = byId.get(row.id);
      if (!match) {
        skipped.push({ row: 0, id: row.id, reason: "no product with this ID" });
        continue;
      }

      const fromGroup = match.group?.name ?? null;
      const toGroup = row.groupName;
      const groupDiffers = (fromGroup === null) !== (toGroup === null) ||
        (fromGroup !== null && toGroup !== null && lc(fromGroup) !== lc(toGroup));
      const variantDiffers = (match.variant ?? null) !== row.variant;

      if (toGroup && !groupByLcName.has(lc(toGroup)) && !seenNewGroups.has(lc(toGroup))) {
        seenNewGroups.add(lc(toGroup));
        newGroupNames.push(toGroup);
      }

      const meta = toGroup ? metaByName.get(lc(toGroup)) : undefined;
      const categoryDiffers = !!(meta?.category && meta.category !== match.category);

      const deactivating = row.discontinued && match.active;

      if (!groupDiffers && !variantDiffers && !categoryDiffers && !deactivating) {
        unchanged++;
        continue;
      }

      if (groupDiffers || variantDiffers) {
        groupChanges.push({
          id: match.id,
          item: match.name,
          fromGroup,
          toGroup,
          fromVariant: match.variant ?? null,
          toVariant: row.variant,
        });
      }
      if (categoryDiffers && meta?.category) {
        categoryChanges.push({ id: match.id, item: match.name, from: match.category, to: meta.category });
      }
      if (deactivating) {
        deactivations.push({ id: match.id, item: match.name, qtyOnHand: match.currentQty });
      }
    }

    // variantLabel updates for existing groups the sheet gives a new label
    const labelChanges: { group: string; from: string; to: string }[] = [];
    for (const g of existingGroups) {
      const meta = metaByName.get(lc(g.name));
      if (meta?.variantLabel && meta.variantLabel !== g.variantLabel) {
        labelChanges.push({ group: g.name, from: g.variantLabel, to: meta.variantLabel });
      }
    }

    const applyFailures: { id: number | null; item: string; reason: string }[] = [];
    let groupsDeleted = 0;

    if (!isDryRun) {
      // 1. Create new groups / update labels. Upsert by unique name using the
      //    sheet's first-seen casing; lc-dedup above prevents "jelly beans"
      //    and "Jelly Beans" becoming two groups within one file.
      for (const name of newGroupNames) {
        try {
          const meta = metaByName.get(lc(name));
          const created = await prisma.productGroup.upsert({
            where: { name },
            update: {},
            create: { name, ...(meta?.variantLabel ? { variantLabel: meta.variantLabel } : {}) },
            select: { id: true, name: true, variantLabel: true },
          });
          groupByLcName.set(lc(created.name), created);
        } catch (err) {
          console.error("Grouping import: group upsert failed", name, err);
          applyFailures.push({ id: null, item: name, reason: "Group could not be created" });
        }
      }
      for (const change of labelChanges) {
        try {
          const g = groupByLcName.get(lc(change.group));
          if (g) {
            await prisma.productGroup.update({
              where: { id: g.id },
              data: { variantLabel: change.to },
            });
          }
        } catch (err) {
          console.error("Grouping import: label update failed", change.group, err);
        }
      }

      // 2. Per-product updates. Grouping fields + optional category + the
      //    one-way active=false. No quantity is ever touched here and no
      //    movement record is created — deactivation is a catalog act.
      const touched = new Map<number, ParsedRow>();
      for (const row of parsed) touched.set(row.id, row);

      const plannedIds = new Set<number>([
        ...groupChanges.map((c) => c.id),
        ...categoryChanges.map((c) => c.id),
        ...deactivations.map((d) => d.id),
      ]);

      for (const id of plannedIds) {
        const row = touched.get(id);
        const match = byId.get(id);
        if (!row || !match) continue;
        try {
          const group = row.groupName ? groupByLcName.get(lc(row.groupName)) : null;
          if (row.groupName && !group) {
            // Group creation failed above — leave this product as it was.
            applyFailures.push({ id, item: match.name, reason: "Group was not created" });
            continue;
          }
          const meta = row.groupName ? metaByName.get(lc(row.groupName)) : undefined;
          await prisma.product.update({
            where: { id },
            data: {
              groupId: group?.id ?? null,
              variant: row.groupName ? row.variant : null,
              ...(meta?.category && meta.category !== match.category
                ? { category: meta.category }
                : {}),
              ...(row.discontinued && match.active ? { active: false } : {}),
            },
          });
        } catch (err) {
          console.error("Grouping import: product update failed", id, err);
          applyFailures.push({ id, item: match.name, reason: "Could not be updated" });
        }
      }

      // 3. Delete groups left with no products. Runs AFTER all reassignments
      //    in this import; onDelete: SetNull on the FK is only the safety net.
      try {
        const deleted = await prisma.productGroup.deleteMany({
          where: { products: { none: {} } },
        });
        groupsDeleted = deleted.count;
      } catch (err) {
        console.error("Grouping import: empty-group cleanup failed", err);
      }
    }

    res.status(isDryRun ? 200 : 201).json({
      success: true,
      data: {
        dryRun: isDryRun,
        groupChanges,
        categoryChanges,
        deactivations,
        newGroups: newGroupNames,
        labelChanges,
        skipped,
        applyFailures,
        unchanged,
        groupsDeleted,
        summary: {
          grouped: groupChanges.filter((c) => c.toGroup !== null).length,
          ungrouped: groupChanges.filter((c) => c.toGroup === null).length,
          newGroups: newGroupNames.length,
          categoryChanges: categoryChanges.length,
          deactivations: deactivations.length,
          deactivationsWithStock: deactivations.filter((d) => d.qtyOnHand > 0).length,
          unchanged,
          errors: skipped.length,
          failed: applyFailures.length,
        },
      },
    });
  } catch (err) {
    console.error("Grouping import error:", err);
    res.status(500).json({ success: false, data: null, error: "Internal server error" });
  }
});

export default router;
