// ─── Pack size + unit-of-measure normalization ──────────────────────
// Hani's master sheet stores "Pack Size" (numeric, e.g. 30, 26.4) and
// "UOM" (e.g. "lb", "ct") as two columns. These helpers are the single
// place both the product routes and the catalog importer normalize them,
// so an inline admin add and a bulk import agree on the canonical form.

// Units Hani actually uses today. Not a hard enum — anything is accepted
// (future "oz", "each", "case"…) — but a value in this set is lower-cased
// to its canonical spelling so "LB"/"Lb"/"lb" don't fork into three.
export const KNOWN_UOMS = ["lb", "ct", "oz", "each", "case", "box", "bag", "gallon"] as const;

const MAX_UOM_LENGTH = 16;

export function normalizeUom(raw: unknown): string | null {
  if (typeof raw !== "string") {
    // tolerate numeric/other by coercing only strings; everything else is null
    if (raw == null) return null;
    raw = String(raw);
  }
  const trimmed = (raw as string).trim().replace(/\s+/g, " ");
  if (trimmed === "") return null;
  const lower = trimmed.toLowerCase();
  // Canonicalize known units to their lowercase spelling; pass others through
  // (trimmed) but bounded so a stray essay can't land in the column.
  if ((KNOWN_UOMS as readonly string[]).includes(lower)) return lower;
  return trimmed.slice(0, MAX_UOM_LENGTH);
}

// Parse a pack size into a non-negative number with at most 3 decimals
// (matches the Decimal(10,3) column). Accepts numbers or numeric strings.
// Returns { ok, value } so callers can distinguish "absent" (null) from
// "present but invalid" (ok:false).
export function parsePackSize(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (raw == null || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, reason: "packSize must be a number" };
  if (n < 0) return { ok: false, reason: "packSize must be non-negative" };
  if (n > 1_000_000) return { ok: false, reason: "packSize is too large" };
  // Clamp to 3 decimals to match the DB column.
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}
