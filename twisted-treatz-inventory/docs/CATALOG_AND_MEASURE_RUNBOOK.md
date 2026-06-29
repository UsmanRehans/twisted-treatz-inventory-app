# Pack Size + UOM + Catalog Import — Deploy Runbook

Adds structured `packSize` (numeric) and `uom` (e.g. "lb"/"ct") to Product so
our sheet mirrors Hani's master inventory count (Item, Category, Qty, Pack
Size, UOM, Brand), puts Brand/Pack Size/UOM into the Bulk Update download, and
ships a guarded **Catalog Import** that ingests Hani's `.xlsx`/`.csv` directly.

> **Prerequisite — the Brand migration must land first.** Production is still
> on the pre-Brand schema (`20260629000000_add_brand_table_and_rename` is
> unapplied). Do the entire [BRAND_MIGRATION.md](BRAND_MIGRATION.md) runbook
> (steps 0–6 at minimum) before anything below. The new code selects the
> `brand` relation and `packSize`/`uom`; running it against the old schema
> throws.

## What changed (code, already merged-ready)

- **Schema**: `Product.packSize Decimal(10,3)?` + `Product.uom String?`
  (migration `20260629020000_add_pack_size_uom`).
- **Products API**: create/PATCH accept & validate `packSize`/`uom`
  (`server/src/lib/measure.ts` normalizes; pack size clamps to 3 decimals).
- **Bulk Update export** now emits `id,item,category,brand,pack_size,uom,qty,new_qty,note`
  (was `id,name,category,purchase_unit,unit_size,current_qty,new_qty,note`).
  The quantity round-trip still keys on `id` + `new_qty`.
- **Catalog Import**: `POST /api/v1/catalog/import` (admin only) + a new
  "Import Catalog" admin tab. Matches by name, creates missing products at
  qty 0 then records the count as an **Adjustment**, updates catalog fields on
  matches. SheetJS (`xlsx@0.20.3`, patched CDN build) parses the file; it is
  lazy-loaded so the iPad floor bundle doesn't carry it.
- **Admin "Add Product"** modal gained Pack Size + UOM fields.

## Ordered steps

| # | Action | Verify |
|---|--------|--------|
| 0 | Complete BRAND_MIGRATION.md (brand table live + backfilled + brand code deployed). | `GET /api/v1/brands` returns brands. |
| 1 | `pg_dump` snapshot (cheap insurance before another DDL). | Dump exists. |
| 2 | `cd server && npx prisma migrate deploy` — applies `20260629020000_add_pack_size_uom`. **Non-breaking**: both columns are nullable, existing code ignores them. | `\d "Product"` shows `packSize`, `uom`. |
| 3 | `cd server && npm test && npx tsc --noEmit` — green. | 142+ tests pass. |
| 4 | Deploy backend (Railway). Confirm it landed (auto-deploy is unreliable). | `GET /api/v1/adjustments/export` header includes `brand,pack_size,uom`. |
| 5 | Deploy frontend (Vercel). | Admin sees "Import Catalog" tab + Pack Size/UOM on Add Product. |
| 6 | **Import Hani's sheet**: Admin → Import Catalog → upload `Inventory Count.xlsx` → review preview → Apply. | See below. |

## Importing Hani's sheet (step 6 detail)

The 302-row file parses cleanly (all 6 columns mapped). The preview will show:

- **New products** — anything whose name we don't already have, created at
  qty 0 with an Adjustment recording the counted Qty.
- **Updated products** — name matches; category/brand/packSize/uom and qty
  reconciled. A blank cell never overwrites an existing value.
- **Flagged (blank cells) — 5 rows Hani must fill in the admin panel:**
  - `Filled Strawberry Delight` — blank Qty → treated as 0
  - `Sour Buttons Peach` — blank Qty → 0
  - `Chicken Feet Gumy` — blank Qty → 0 *(also a likely typo for "Gummy")*
  - `Vidal Sour Wild Raspberries` — missing Pack Size, UOM, Brand
  - `Curad` — missing Pack Size, UOM
- A **"set to 0"** count, with a typed `ZERO` confirmation if ≥20 products
  would be zeroed (backstop against a half-filled file).

> If the import would create ~all 302 as *new*, the catalog hasn't been seeded
> with matching names yet — that's expected on a fresh DB and fine. If you
> expected matches and see all-new, the names differ from ours; reconcile
> before applying.

## Invariants this touches (hand to James `/qa` + Zahid `/security-sweep`)

- New products are still born at `currentQty:0`; the counted Qty arrives only
  via an Adjustment (qty update + audit row in one transaction). Stock never
  appears without an audit record.
- Catalog-field updates (category/brand/pack/uom) are NOT stock movements — no
  Adjustment is written for them.
- `POST /api/v1/catalog/import` is `requireAdmin`. No new public routes.
- **Zahid note**: SheetJS is pinned to the patched `xlsx@0.20.3` CDN tarball
  (the npm-registry `xlsx@0.18.5` has unpatched prototype-pollution CVEs).
  Keep the CDN pin; don't let a future `npm install xlsx` silently downgrade.

## Rollback

The migration is additive and nullable — `prisma migrate resolve` + a manual
`ALTER TABLE "Product" DROP COLUMN "packSize", DROP COLUMN "uom";` reverses it
with no data loss to other columns. Imported quantities are Adjustments and can
be audited/corrected via the Activity Log like any other stock movement.
