// ─── Inventory sheet parser ──────────────────────────────────────────
// Reads Hani's master sheet (.xlsx or .csv) into catalog import rows.
// Column matching is forgiving: case-insensitive, trims, and accepts a few
// header aliases so "Pack Size" / "packsize" / "pack" all land in packSize.
// SheetJS is pinned to the patched 0.20.x CDN build (see package.json).

import * as XLSX from "xlsx";
import type { CatalogImportRow } from "../api/adminClient";

// Header aliases → canonical field. First match wins.
const ALIASES: Record<keyof Omit<CatalogImportRow, never>, string[]> = {
  item: ["item", "name", "product"],
  category: ["category", "cat"],
  qty: ["qty", "quantity", "count", "current_qty", "on hand", "on-hand"],
  packSize: ["pack size", "packsize", "pack_size", "pack"],
  uom: ["uom", "unit", "unit of measure", "units"],
  brand: ["brand", "brand name"],
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
    });
  }

  return { rows, missingColumns, totalRows: rows.length };
}
