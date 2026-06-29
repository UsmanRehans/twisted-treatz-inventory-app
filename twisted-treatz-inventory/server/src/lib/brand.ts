// ─── Brand name normalization ───────────────────────────────────────
// One canonical normalizer shared by the inline "+ new brand" create
// path (routes/brands.ts) and the one-shot backfill (scripts/backfill-
// brands.ts). They MUST agree, or the backfill produces "Albanese" while
// a later inline add produces "albanese " — two rows, defeating the
// @unique index. Normalize before every write; the index is the backstop.

export function normalizeBrandName(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  // Trim and collapse internal runs of whitespace to a single space.
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed === "") return null;
  // Title-case as the default canonical form. Special-casing (e.g. "HEB"
  // staying upper) is handled by the human-approved merge map in backfill,
  // or by an admin renaming the brand after the fact.
  return collapsed
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
