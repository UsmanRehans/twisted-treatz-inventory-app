// ─── Inventory sheet parser ──────────────────────────────────────────
// Reads Hani's master sheet (.xlsx or .csv) into catalog import rows.
// Column matching is forgiving: case-insensitive, trims, and accepts a few
// header aliases so "Pack Size" / "packsize" / "pack" all land in packSize.
// SheetJS is pinned to the patched 0.20.x CDN build (see package.json).

import * as XLSX from "xlsx";
import type {
  CatalogImportRow,
  GroupingImportRow,
  GroupingGroupMeta,
} from "../api/adminClient";

// Header aliases → canonical field. First match wins.
const ALIASES: Record<keyof Omit<CatalogImportRow, never>, string[]> = {
  item: ["item", "name", "product"],
  category: ["category", "cat"],
  qty: ["qty", "quantity", "count", "current_qty", "on hand", "on-hand"],
  packSize: ["pack size", "packsize", "pack_size", "pack"],
  uom: ["uom", "unit", "unit of measure", "units"],
  brand: ["brand", "brand name"],
  supplier: ["supplier", "vendor"],
  alertThreshold: ["alert threshold", "threshold", "alert_threshold", "reorder point"],
};

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

// DoS guards: a hostile/oversized workbook is parsed entirely in the admin's
// browser tab, so cap before and after read. 15 MB and 10k rows are far above
// a real candy-shop catalog (~300 rows) but stop a zip-bomb / billion-cell
// sheet from hanging the tab. The server independently caps the batch at 2000.
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_SHEET_ROWS = 10_000;

export interface ParsedSheet {
  rows: CatalogImportRow[];
  /** Canonical fields we could NOT find a column for (e.g. ["brand"]). */
  missingColumns: string[];
  totalRows: number;
}

export async function parseInventorySheet(file: File): Promise<ParsedSheet> {
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB)`);
  }
  const buf = await file.arrayBuffer();
  // cellFormula:false avoids carrying formula strings; we only want values.
  const wb = XLSX.read(buf, { type: "array", cellFormula: false, cellHTML: false });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error("The file has no sheets");
  const ws = wb.Sheets[firstSheet];

  // Array-of-arrays so we can locate the header row ourselves.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
  if (grid.length < 2) throw new Error("The sheet has no data rows");
  if (grid.length > MAX_SHEET_ROWS) {
    throw new Error(`Sheet has too many rows (max ${MAX_SHEET_ROWS.toLocaleString()})`);
  }

  const headerRow = grid[0].map(norm);
  const colOf = (field: keyof typeof ALIASES): number => {
    for (const alias of ALIASES[field]) {
      const idx = headerRow.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const cols = {
    item: colOf("item"),
    category: colOf("category"),
    qty: colOf("qty"),
    packSize: colOf("packSize"),
    uom: colOf("uom"),
    brand: colOf("brand"),
    supplier: colOf("supplier"),
    alertThreshold: colOf("alertThreshold"),
  };

  if (cols.item === -1) {
    throw new Error('Could not find an "Item" (or "Name") column in the sheet');
  }

  const missingColumns = (Object.keys(cols) as (keyof typeof cols)[])
    .filter((k) => k !== "item" && cols[k] === -1);

  const cell = (row: unknown[], idx: number): unknown => (idx === -1 ? null : row[idx]);
  const str = (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  const num = (v: unknown): number | null => {
    if (v == null || String(v).trim() === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  };

  const rows: CatalogImportRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    const item = str(cell(row, cols.item));
    if (!item) continue; // skip rows with no item name (blank trailing rows etc.)
    rows.push({
      item,
      category: str(cell(row, cols.category)),
      brand: str(cell(row, cols.brand)),
      packSize: num(cell(row, cols.packSize)),
      uom: str(cell(row, cols.uom)),
      // qty: blank stays null here; the SERVER applies the empty→0 rule and
      // flags it, so the preview can show the admin exactly what gets zeroed.
      qty: num(cell(row, cols.qty)),
      // supplier/threshold: blank = no change (server-side rule; empty→0 is
      // qty-only and must never zero a threshold).
      supplier: str(cell(row, cols.supplier)),
      alertThreshold: num(cell(row, cols.alertThreshold)),
    });
  }

  return { rows, missingColumns, totalRows: rows.length };
}

// ─── Grouping sheet parser ──────────────────────────────────────────
// Reads the "Product Grouping" sheet back: a Products tab (ID, Group,
// Variation, Discontinued) and an optional Groups tab (Group, Category to
// use, Type of variation). An .xlsx keeps both tabs; a single-table CSV
// just has no Groups metadata, which is fine — labels/categories keep
// their current values.

export interface ParsedGroupingSheet {
  rows: GroupingImportRow[];
  groups: GroupingGroupMeta[];
  totalRows: number;
}

export async function parseGroupingSheet(file: File): Promise<ParsedGroupingSheet> {
  if (file.size > MAX_BYTES) {
    throw new Error(`File is too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB)`);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellFormula: false, cellHTML: false });

  const findSheet = (want: string): string | null =>
    wb.SheetNames.find((n) => norm(n) === want) ?? null;

  // Products rows live on a tab named "Products", else the first tab.
  const productsSheet = findSheet("products") ?? wb.SheetNames[0];
  if (!productsSheet) throw new Error("The file has no sheets");

  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[productsSheet], {
    header: 1,
    blankrows: false,
    defval: null,
  });
  if (grid.length < 2) throw new Error("The sheet has no data rows");
  if (grid.length > MAX_SHEET_ROWS) {
    throw new Error(`Sheet has too many rows (max ${MAX_SHEET_ROWS.toLocaleString()})`);
  }

  const header = grid[0].map(norm);
  const col = (...aliases: string[]): number => {
    for (const a of aliases) {
      const idx = header.findIndex((h) => h === a || h.startsWith(a));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idCol = col("id");
  const groupCol = col("group");
  const variationCol = col("variation", "variant");
  const discontinuedCol = col("discontinued");
  if (idCol === -1 || groupCol === -1) {
    throw new Error('Could not find the "ID" and "Group" columns — is this the Grouping sheet?');
  }

  const str = (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };

  const rows: GroupingImportRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    const idRaw = str(row[idCol]);
    if (!idRaw) continue; // blank trailing rows
    rows.push({
      id: Number(idRaw),
      group: str(row[groupCol]),
      variation: variationCol !== -1 ? str(row[variationCol]) : null,
      discontinued: discontinuedCol !== -1 ? str(row[discontinuedCol]) : null,
    });
  }

  // Optional Groups tab → metadata (category + variant label per group).
  const groups: GroupingGroupMeta[] = [];
  const groupsSheet = findSheet("groups");
  if (groupsSheet) {
    const gGrid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[groupsSheet], {
      header: 1,
      blankrows: false,
      defval: null,
    });
    if (gGrid.length > 1) {
      const gHeader = gGrid[0].map(norm);
      const gCol = (...aliases: string[]): number => {
        for (const a of aliases) {
          const idx = gHeader.findIndex((h) => h === a || h.startsWith(a));
          if (idx !== -1) return idx;
        }
        return -1;
      };
      const nameCol = gCol("group");
      const categoryCol = gCol("category to use", "category");
      const labelCol = gCol("type of variation", "variant label", "variation label");
      if (nameCol !== -1) {
        for (let i = 1; i < gGrid.length; i++) {
          const row = gGrid[i];
          const name = str(row[nameCol]);
          if (!name) continue;
          groups.push({
            group: name,
            category: categoryCol !== -1 ? str(row[categoryCol]) : null,
            variantLabel: labelCol !== -1 ? str(row[labelCol]) : null,
          });
        }
      }
    }
  }

  return { rows, groups, totalRows: rows.length };
}
