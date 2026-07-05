# Product Edit + Deactivate — Deploy Runbook

Gives Hani an **Edit Product** modal (rename, fix purchase unit / pack size /
UOM / brand / supplier / flavor / used-in / price / threshold) and a
**Deactivate / Reactivate** flow so discontinued SKUs disappear from the floor
without deleting their Removal/Receipt history. Built for the pre-China
cleanup: ~15–20 SKUs to retire, assorted "case vs bags" typos to fix.

> **No migration in this release.** The `active` flag, `packSize`, `uom`, and
> the Brand relation all already exist in production. This is a code-only
> deploy — backend + frontend, either order, no DB steps, no snapshot needed.

## What changed (code)

- **Products API — PATCH `/api/v1/products/:id`** (admin only,
  `server/src/routes/products.ts`): allowlist widened with `purchaseUnit`,
  `flavor`, `supplier`, `usedIn`. Required-on-model strings (`name`,
  `category`, `purchaseUnit`) reject empty/non-string; optional ones
  (`flavor`, `supplier`, `usedIn`) accept `null`/blank to clear. Everything
  is trimmed and capped at 200 chars. `active` must be a boolean.
  `currentQty` remains excluded — stock still only moves via
  Removals/Receipts/Adjustments.
- **Products API — GET `/api/v1/products`**: new `?includeInactive=true`
  param, honored **only for admin tokens**. Team/iPad tokens keep the
  `active: true` filter no matter what they send — the floor can never see
  retired SKUs.
- **Admin UI**: every row in the Products tab has an **Edit** action opening
  `EditProductModal` (same form language as Add Product). Current stock is
  read-only in the modal ("stock changes via Receiving and Adjustments").
  The modal PATCHes only fields that actually changed.
- **Deactivate / Reactivate**: danger-styled button at the bottom of the Edit
  modal with a one-step confirm (history is kept; reversible). A **Show
  inactive** checkbox in the Products tab reveals retired products greyed out
  with an `Inactive` badge and a one-click **Reactivate**.
- **Security fix (Zahid + James both flagged)**: `GET /api/v1/products/:id`
  now 404s inactive products for team tokens — previously the iPad could
  read retired SKUs by ID, bypassing the list filter.
- **Robustness fix (James)**: `unitPrice` on POST/PATCH now rejects
  non-numeric and negative values with a 400 (previously a bad string
  crashed the request with a 500).
- **Deps**: `npm audit fix` in `server/` cleared the axios/form-data
  advisories (SendGrid SDK chain). The remaining bcrypt→tar advisories are
  install-time-only and deferred to a dedicated bcrypt 6 bump.

## Invariants re-verified (no code change needed, tests pin them)

- Inactive products already can't take Removals (`removals.ts` rejects 404)
  or Receipts (`receipts.ts` rejects 404) — pre-existing tests cover both.
- Low-stock alerts can't fire for inactive products: the only trigger is the
  removal flow (blocked above) and the digest query filters `active = true`
  (`alertService.ts`).
- Rename keeps history intact: Removals/Receipts join by `productId`, so old
  activity-log rows display the **new** name after a rename. That is correct
  behavior for a rename, not a bug — don't "fix" it.

## Ordered steps

| # | Action | Verify |
|---|--------|--------|
| 1 | `cd server && npm test && npx tsc --noEmit` — green (193+ tests). | All pass, incl. the PATCH-allowlist, includeInactive fail-closed, inactive-by-ID, and unitPrice tests in `tests/products.test.ts`. |
| 2 | `cd client && npm run build` — green. | Build completes. |
| 3 | Merge PR into `main`. | — |
| 4 | Deploy backend: `railway up` **from repo root** (auto-deploy is unreliable — confirm it landed). | As admin: `GET /api/v1/products?includeInactive=true` returns rows; `PATCH` a product's `purchaseUnit` succeeds. |
| 5 | Deploy frontend (Vercel auto-deploy on main, or `vercel --prod`). | Products tab shows Edit buttons + "Show inactive" checkbox. |
| 6 | Smoke test as admin (see below). | — |
| 7 | Hand off to Hani for the cleanup pass. | — |

## Post-deploy smoke test (2 minutes)

1. Admin → Products → Edit any product → change nothing → Save → modal closes,
   no PATCH fired (network tab quiet).
2. Edit a product with the "bags vs case" mistake → set Purchase Unit to
   `Case` → Save → table row shows `Case`.
3. Edit a throwaway product → Deactivate → confirm → row disappears.
   Tick **Show inactive** → row reappears greyed with `Inactive` badge →
   Reactivate → badge clears.
4. On the floor iPad (team login): confirm the deactivated-then-reactivated
   product behaved — while inactive it must NOT appear in the product grid.
5. Rename a product that has removal history → Activity log shows the new
   name on old rows (expected).

## Hani's cleanup pass (what to tell him)

- **Fix typos**: Products → Edit (pencil on the row) → correct Purchase Unit
  ("Bags" → "Case"), Pack Size, UOM, Brand → Save Changes.
- **Retire the 15–20 discontinued items**: Edit → Deactivate product →
  confirm. They vanish from the iPad and all lists but keep their history.
  Changed brands? Deactivate the old-brand product and add (or reactivate)
  the new one.
- **Un-retire anytime**: tick "Show inactive" → Reactivate.
- Quantities can't be edited here on purpose — receiving and adjustments are
  the only doors stock moves through.
