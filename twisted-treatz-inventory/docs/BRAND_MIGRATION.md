# Brand-as-Entity — Production Migration Runbook

Promotes the free-text `Product.brand` column into a first-class `Brand`
table. Migrations are applied **manually** (`prisma migrate deploy`, never on
deploy) and auto-deploy is unreliable, so this is a deliberate, ordered
procedure. The rename in step 2 makes the currently-deployed code throw until
the new code ships in step 5 — **do steps 2→5 in one short maintenance
window** (off-hours; ~10 min for a 7-person internal tool).

> The drop of `brandText` (the final, destructive step) is intentionally NOT
> committed as a Prisma migration folder — if it were, `prisma migrate deploy`
> would apply it right after Migration A, before the backfill runs. Create it
> as a migration only after backfill verification passes (step 7).

## Ordered steps

| # | Action | Verify before proceeding |
|---|--------|--------------------------|
| 0 | `pg_dump` snapshot of prod. This is the only copy of the free-text brand data. | Dump file exists, non-trivial size. |
| 1 | **Audit (read-only):** `npx tsx --env-file=.env scripts/backfill-brands.ts` (dry-run). Review the raw→canonical mapping. Edit `scripts/brand-merge-map.json` to merge dupes / drop junk values. Re-run dry-run until the mapping is right. | Mapping reviewed and committed. |
| 2 | **Migration A** (begin maintenance window): `npx prisma migrate deploy`. Applies `20260629000000_add_brand_table_and_rename` — creates `Brand`, renames `brand`→`brandText`, adds nullable `brandId` FK. | `\d "Product"` shows `brandText`, `brandId`, FK; `Brand` table exists. ⚠ Live code is now broken (selects `brand`) until step 5. |
| 3 | **Backfill dry-run** against the migrated DB: confirm counts look sane. | Distinct canonical brand count and null count match expectations. |
| 4 | **Backfill apply:** `npx tsx --env-file=.env scripts/backfill-brands.ts --apply`. | Script prints `✓ Reconciliation clean` (orphan count == expected null count). |
| 5 | **Deploy backend** (the brand code: POST /products, brand routes, GET filter/shape). Confirm it actually landed — auto-deploy is unreliable. | `GET /api/v1/brands` returns the backfilled brands; `GET /api/v1/products` returns flat `brand` string + `brandId`. End maintenance window. |
| 6 | **Deploy frontend** (Vercel): brand filter, Add-Product form, brand picker. `VITE_API_URL` is baked at build. | Admin can filter by brand and add a product. |
| 7 | **Migration C — drop `brandText`** (ONE-WAY, destructive). Only after step 4 verified clean. Generate it then: `npx prisma migrate dev --name drop_brand_text --create-only` after removing `brandText` from `schema.prisma`, review the SQL below, then `prisma migrate deploy`. Deploy code with `brandText` gone. | App still works; `brandText` column gone. Keep the step-0 snapshot a few days. |

### Migration C SQL (for reference — create as a migration only at step 7)

```sql
-- Destructive: run ONLY after backfill verification passes (orphans == 0).
ALTER TABLE "Product" DROP COLUMN "brandText";
```

And remove the transitional line from `schema.prisma`:

```prisma
// DELETE this line from model Product:
//   brandText      String?
```

## Rollback

- Before step 4 (no data linked yet): Migration A is effectively reversible —
  `brandText` still holds every original value. Rename it back and drop the
  `Brand` table / `brandId` column if you must abort.
- After step 7: `brandText` is gone; recover from the step-0 `pg_dump`.

## Invariants this touches

- "Only admins add stock" — `POST /products` creates at `currentQty:0`; stock
  only ever moves via Receipts. Guarded by `requireAdmin` + a hard-coded `0`.
- Auth surface — new admin-gated writes (`POST /products`, `POST`/`PATCH
  /brands`); new read `GET /brands` is `requireAnyAuth`. No new public routes.

Hand to **James** (`/qa`) to verify the create-product + backfill reconciliation,
and **Zahid** (`/security-sweep`) for the new admin-gated write surfaces.
