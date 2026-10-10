# Repository audit — twisted-treatz-inventory-app

Audited 2026-10-09 against `origin/main` at `9d34c9d` (merge of PR #24). Fixes are on branch `UsmanRehans/audit`. Evidence was produced in this session: file and line references point at that commit, commands were run in a clean worktree, and live checks hit the production backend and frontend read-only.

## Summary (five lines)

1. The app's core promises hold: stock moves are transactional and audited, roles are enforced, hashes never leave the API, sessions revoke on password change, and 216 tests pass. The code is in better shape than its docs.
2. Two live, user-facing features are silently off in production: low-stock emails and password-reset emails have never been able to send because the SendGrid variables on Railway are empty. The logs still say "alert sent".
3. One documented command is dangerous: `npm run db:seed` deletes every receipt, removal and alert log before it fails on a foreign key, and the local `.env` points at the production database.
4. The docs (CLAUDE.md, runbooks, agent files) had drifted far from the code: wrong paths, wrong table names, a false "blank cells never overwrite" promise, a runbook claiming production was on an old schema. The PR corrects 25 such claims and fixes one real crash (expired session on the receiving page).
5. Client lint has been red since the first commit; test coverage looked stronger than it was (several tests passed with the thing they named removed). The PR fixes the tests; the lint refactors and all behaviour changes stay here as findings.

## How to read this

- **Grade**: *confirmed* = reproduced by a command, a live run, or an exact doc-vs-code contradiction; *likely* = strong code evidence, not reproduced; *suspected* = pattern only.
- **Status**: *Fixed in PR* = on `UsmanRehans/audit`; *Open* = needs a judgment call, left for you.
- Paths are relative to `twisted-treatz-inventory/` unless they start with `/`.

---

## Findings, ranked by impact

### 1. Low-stock and password-reset emails cannot send in production — confirmed, code side **Fixed in the fixes PR**, Railway variables still Open
**Evidence.** `railway variables --service twisted-treatz-backend --environment production --json` (filtered to names and lengths only): `SENDGRID_API_KEY`, `ALERT_FROM_EMAIL` and `ALERT_TO_EMAIL` are all present but empty strings; `ADMIN_BASE_URL` and `APP_BASE_URL` are unset. `server/src/services/alertService.ts:16-31` warns at boot and `:147-153` returns from `sendLowStockEmail` before `sgMail.send` when any of the three is falsy; the function then still writes the `AlertLog` row (`:97-99`) and logs `Low stock alert sent` (`:101-103`). The last 59 retained Railway log lines contain the boot warnings `Email alerts are disabled` and `Reset emails are disabled`, plus 26 `Email not sent — SendGrid is not configured` lines paired with 26 `Low stock alert sent` lines (products such as "Nuts & Seed Mix", "Jelly Pumpkins"). `server/src/services/passwordResetService.ts:17-31` disables reset mail the same way.
**Cost.** Hani never receives a low-stock email, the dedupe row is written anyway, and the "forgot password" flow on the live site tells the admin to check an inbox that will never get a message.
**Fix.** Set `SENDGRID_API_KEY`, `ALERT_FROM_EMAIL`, `ALERT_TO_EMAIL` and `ADMIN_BASE_URL` on Railway and redeploy — this part still needs you. The code side is done on the fixes branch: `AlertLog` is written and "sent" is logged only after a successful send (otherwise a clear "NOT emailed" warning and nothing recorded, verified on a local database), and the forgot-password route answers 503 "Password reset email is not configured on this server" (same for every address, no lookup), which the page displays.

### 2. `npm run db:seed` partially wipes whatever database `.env` points at, which locally is production — confirmed, **Fixed in the fixes PR**
**Evidence.** `server/prisma/seed.ts:129-133` runs `receipt.deleteMany`, `removal.deleteMany`, `alertLog.deleteMany`, `product.deleteMany`, `brand.deleteMany` sequentially with no transaction and never touches `adjustment`. `server/prisma/migrations/20260612120000_add_adjustment/migration.sql:24` declares `Adjustment.productId … ON DELETE RESTRICT`. Production has Adjustment rows (every catalog import and `scripts/mark-high-risk.ts` writes them). So the seed deletes all receipts, removals and alert logs, then aborts on the product delete. `.claude/agents/gideon.md:34` and `isaiah.md:53` state the local `server/.env` `DATABASE_URL` is production; `server/.env.example:20` presents the seed as a routine command. The seed's own comment at `:207-209` claimed removals are never wiped (corrected in the PR).
**Cost.** One habitual `npm run db:seed` from a laptop erases all movement history in production before failing, with no backup step.
**Fix (done).** The seed refuses to run with `NODE_ENV=production` and unless `SEED_ALLOW_WIPE` equals the `DATABASE_URL` host (you must type the name of the database you are wiping); all deletes, adjustments included, run in one transaction. Verified: without the flag it exits with the refusal before connecting; with the flag it seeded a throwaway Postgres (203 products, 41 brands, 6 members). Still worth doing: point local `.env` at a dev database by default.

### 3. Receiving page crashed to a blank screen when the admin session expired — confirmed, **Fixed in PR**
**Evidence.** Pre-fix `client/src/pages/Receive.tsx:79-82` returned `<Navigate>` above four hooks (lint: four `react-hooks/rules-of-hooks` errors). Reproduced in the browser: with an admin JWT whose `exp` had passed in `localStorage`, `/admin/receive` threw `Rendered fewer hooks than expected`, `#root` was empty and the URL stayed on `/admin/receive`. Admin tokens live 24 h (`server/src/services/tokenService.ts:48`), so any admin returning to a bookmarked receiving page a day later hit this. After moving the guard below the hooks the same setup redirects to `/admin/login` ("Welcome back"); `npm run build` passes and the four lint errors are gone.
**Cost (before).** A blank page instead of the login screen, once a day for anyone who keeps the receiving page open.

### 4. The admin sidebar's "Log Out" does not end the session — confirmed, **Fixed in the fixes PR**
**Evidence.** `client/src/hooks/useAdminAuth.ts:13-19` keeps the token in `useState` per hook instance; `AdminSidebar.tsx:43,102` calls its own instance's `logout`, while `Admin.tsx:26-33` and `Receive.tsx` hold a separate instance that never re-evaluates. Reproduced in the browser: after clicking Log Out on `/admin`, the URL stayed `/admin`, every tab remained rendered and clickable, and only `localStorage` was cleared; the page's in-memory token still authorizes requests until a reload.
**Cost.** On the shared office computer, "Log Out" leaves the dashboard fully usable.
**Fix (done).** The sidebar navigates to `/admin/login` after `logout()`. Verified in the browser against a local database: Log Out lands on the login page and revisiting `/admin` stays there.

### 5. `npm start` ran a file the build never produces — confirmed, **Fixed in PR**
**Evidence.** `server/tsconfig.json` (`rootDir: "."`, includes `src` and `prisma`) emits `dist/src/index.js`; `server/package.json` start script was `node dist/index.js`. Verified: `npx tsc && find dist -name index.js` → only `dist/src/index.js`; `npm start` → `Cannot find module …/dist/index.js`. `railway.json` and `Procfile` already used `dist/src/index.js`, which is why production never noticed.
**Cost (before).** Anyone starting the server outside Railway got an immediate crash; three files disagreed about the entry point.

### 6. Catalog runbook promised "a blank cell never overwrites", but a blank Qty sets a matched product's stock to 0 — confirmed, **doc fixed in PR**, behaviour Open
**Evidence.** `docs/CATALOG_AND_MEASURE_RUNBOOK.md:49-50` vs `server/src/routes/catalog.ts:159-162` (blank qty → 0, flagged), `:269-284` (update queued with `qtyAfter: 0`) and `:362-378` (`currentQty = qtyAfter` written with an Adjustment). The runbook contradicted itself two lines later ("blank Qty → treated as 0").
**Cost.** An admin uploading a half-counted sheet and trusting line 50 zeroes stock for every matched row with an empty Qty; the typed-`ZERO` guard only triggers at 20 or more.
**Fix.** The doc now says what the code does. Whether blank Qty should mean "skip" instead of "0" is a product call for Rick and Hani.

### 7. Stock writes are read-then-write outside the transaction, so concurrent requests can lose an update — confirmed, **Fixed in the fixes PR**
**Evidence.** `server/src/routes/removals.ts:39-42` reads `currentQty`, `:54` checks it, `:63-71` writes an absolute `currentQty: qtyAfter` inside `$transaction`; `receipts.ts:46-49,61-65` does the same with `currentQty + actualQty`. No `decrement`/`increment`, no `where: { currentQty: { gte: qty } }`, and no CHECK constraint on `Product.currentQty` (`schema.prisma:28`). Not reproduced (needs a live database).
**Cost.** Two overlapping requests on one product (a receipt while the floor removes, or two removals) both compute from the same base and the second overwrites the first; the audit snapshots look consistent, so the discrepancy is invisible. Low probability with one iPad and one admin, undetectable when it happens.
**Fix (done).** Removals now run a guarded `updateMany` (`currentQty >= qty`, `decrement`) inside an interactive transaction and read the row back for the snapshots; receipts use `increment`. Reproduced and verified on a local Postgres: two simultaneous removals of 16 from a stock of 30 gave one 201 and one 400 ("Current quantity: 14"), exactly one Removal row, and a stock of 14; five simultaneous removals of 1 all succeeded and left 9.

### 8. The admin reset script does not revoke existing sessions — confirmed, **Fixed in the fixes PR**
**Evidence.** `server/scripts/reset-admin-password.ts:37-40` updates only `passwordHash`; `server/src/routes/auth.ts:293` and `:459` increment `tokenVersion` on change and reset; `CLAUDE.md` promises "Admin password change/reset revokes all outstanding admin JWTs".
**Cost.** After an emergency reset, tokens minted with the old password stay valid for up to 24 h.
**Fix (done).** The script now increments `tokenVersion` (verified: 0 → 1 on a local database) and says so; Gideon's agent file points at it.

### 9. Off-the-happy-path responses are HTML, not the JSON envelope — confirmed, **Fixed in the fixes PR**
**Evidence.** `server/src/app.ts` registers no 404 handler and no error middleware. Probed on an ephemeral port: `GET /api/v1/does-not-exist` → `404 text/html`; a malformed JSON body to `/api/v1/auth/admin/login` → `400 text/html`; `/api/v1/health` → JSON. Client side, `client/src/api/adminClient.ts:110-115` calls `res.json()` unguarded; in the browser with the backend down the dashboard showed the raw error `Failed to execute 'json' on 'Response': Unexpected end of JSON input`.
**Cost.** Any typo'd path or proxy error surfaces as a JSON parse error instead of the server's message; CLAUDE.md's "All responses: { success, data, error? }" is only true for mounted routes.
**Fix (done).** JSON 404 catch-all and error handler (malformed body → 400, oversized → 413) in `app.ts`; both client wrappers now explain "The inventory API did not respond (HTTP n)" instead of a parse error. Verified with curl on a local server.

### 10. "Per day" and "today" are UTC days while the docs promise America/Chicago — confirmed, **Fixed in the fixes PR**
**Evidence.** `server/src/services/alertService.ts:113-117` and `server/src/routes/adminStats.ts:24-28` use `setUTCHours`; the removals/receipts/activity date filters (`removals.ts:155-166`, `receipts.ts:139-150`, `adminStats.ts:92-99`) parse `YYYY-MM-DD` as UTC. Only email display uses Chicago (`emailTemplates.ts:30-41`). UTC midnight is 7 pm CDT / 6 pm CST.
**Cost.** "Removed today" resets at 7 pm, an evening removal lands on tomorrow's filter, and a product can alert twice in one business day.
**Fix (done).** `server/src/lib/businessDay.ts` computes Chicago calendar-day bounds (DST tested for 2026-03-08 and 2026-11-01) and all five call sites use it; date filters accept `YYYY-MM-DD` and answer 400 otherwise. Verified at 23:05 CDT on a local database: the dashboard's "Removed Today" showed the evening's 21 units, which UTC logic would have filed under tomorrow.

### 11. Bulk count and threshold imports can half-apply and return a 500 that names no rows — confirmed, **Fixed in the fixes PR**
**Evidence.** `server/src/routes/adjustments.ts:213-231` and `thresholds.ts:173-178` loop over rows with one `$transaction` each and no per-row try/catch; a throw on row *k* leaves rows 1..k-1 committed and returns the generic 500 (`adjustments.ts:261-267`). `catalog.ts:289-293,344-347,382-385` already does per-row catch and reports `applyFailures`. `adjustments.ts:92` promises "one bad row never blocks the rest". No test covers a mid-batch failure in either file.
**Cost.** A 300-row count import that fails on row 150 leaves half the counts applied with nothing in the UI saying which half.
**Fix (done).** Both importers catch per row, keep going, and return `applyFailures` plus `summary.failed`; the Bulk Update and Thresholds screens list the failed rows with a retry hint.

### 12. A decimal alert threshold passes validation and becomes a 500 — confirmed, **Fixed in the fixes PR**
**Evidence.** `server/src/routes/products.ts:207-216` (POST) and `:411-421` (PATCH) accept any non-negative `Number`; `alertThreshold` is `Int` in the schema. A probe with a stubbed Prisma showed `2.5` reaching `product.update` and the catch returning `Internal server error`. `thresholds.ts:111-116` (bulk) already requires an integer.
**Cost.** Typing "7.5" in the inline editor gives "Internal server error" with no hint.
**Fix (done).** Both validators require a non-negative integer (verified: PATCH with 2.5 → 400 "must be a non-negative integer").

### 13. Low-stock email button defaults to the marketing site — confirmed, **Fixed in the fixes PR** (default now the inventory host); setting `ADMIN_BASE_URL` on Railway is still recommended
**Evidence.** `server/src/services/emailTemplates.ts:17` defaults `ADMIN_BASE_URL` to `https://twistedtreatz.com`; `passwordResetService.ts:15-16` uses a different variable, `APP_BASE_URL`, defaulting to `https://inventory.twistedtreatz.com`. Neither was in `.env.example` (now added); `ADMIN_BASE_URL` is unset on Railway.
**Cost.** Moot while emails are off (finding 1); the day they are turned on, every "Receive Stock" button links to `twistedtreatz.com/admin/receive`.
**Fix.** Default both to the inventory host (or read one variable), and set it on Railway.

### 14. Client lint has failed since the initial commit — confirmed, **Fixed in the fixes PR** (`npm run lint` exits 0)
**Evidence.** `npm run lint` on `origin/main`: 10 errors, 1 warning. `eslint-plugin-react-hooks ^7.0.1` has been pinned since commit `13da445` (2026-04-05), and its `recommended` flat config enables `set-state-in-effect` and `rules-of-hooks`. After the PR: 6 errors, 1 warning, all needing small refactors: `react-hooks/set-state-in-effect` in `ActivityLog.tsx:93,98`, `StatCards.tsx:26`, `PinPad.tsx:23`, `useAdminAuth.ts:50`; `react-refresh/only-export-components` in `AdminSidebar.tsx:23` (move `ADMIN_TABS` to its own file); `exhaustive-deps` warning in `FloorApp.tsx:92`.
**Cost.** Lint cannot gate anything; new errors hide in old noise.
**Fix (done).** The six were fixed with the React-recommended patterns (derived loading flags, render-time prop comparison, initializer-based expiry check, tab list moved to its own file, callback declared before the effect that uses it), each verified in the browser against a local database; `npm run lint` is now in CLAUDE.md's pre-merge checks.

### 15. CLAUDE.md described a project that no longer exists — confirmed, **Fixed in PR**
File-structure tree pointed at `server/routes`, `server/services/alerts.ts` (actual: `server/src/routes`, `alertService.ts`); table list used `products`/`users`/`removals(user_id)` and omitted `Brand`, `Adjustment`, `AlertLog`; invariants omitted Adjustment and over-generalised "reads accept either token" (receipts, stats, exports are admin-only); alert rules said "any product qty drops" and "master admin email" (only floor removals trigger; recipient is `ALERT_TO_EMAIL`); "204 SKUs in twisted_treatz_inventory.xlsx" (CSV has 203 rows; no xlsx tracked; no supplier column); "6 team members" (live public endpoint returns 3); "Retired blueprints … useful as reference" (not tracked; the developer's global gitignore excludes `.claude/`); "Prettier formatting on every save" (no Prettier anywhere); "Build Order (follow this sequence)" (all done). Each is one commit with its evidence.

### 16. Runbooks contradicted each other and the code — confirmed, **Fixed in PR**
`CATALOG_AND_MEASURE_RUNBOOK.md` said production was still on the pre-Brand schema while `PRODUCT_EDIT_DEACTIVATE_RUNBOOK.md` said the Brand relation already exists there; `BRAND_MIGRATION.md` had no status (steps 0–6 applied, step 7 `brandText` drop still outstanding — the column is still in `schema.prisma`) and never said its commands run from `server/`; `PRODUCT_EDIT…` deferred a bcrypt 6 bump that had already happened; both carried stale test counts; `MASTER_KICKOFF_PROMPT.md` had no historical banner despite referencing untracked agents, a 60-second undo that was never built and 204 rows.

### 17. Agent files gave stale instructions — confirmed, **Fixed in PR**
`zahid.md` told the security sweep that `cors()` allows all origins (it is pinned in `app.ts`; live preflight from a foreign origin returns no allow-origin header); `gideon.md`'s admin-create recipe skipped `isAllowedAdminEmail` and did not mention the tracked reset script; `rick.md`'s data model omitted Brand and Adjustment; `DESIGN_TOKENS.md` omitted seven colour stops that `index.css` defines.

### 18. Tests that passed with the thing they named removed — confirmed, **Fixed in PR**
Admin-login rate-limit test accepted `[401, 429]` on every attempt (per-email limit could be deleted); PIN test asserted nothing in its loop; no test asserted that a low-stock email is sent (SendGrid env was never stubbed, so the send path never ran); "checks today's window" asserted only that two Dates exist; "transactional" tests counted `$transaction` calls without checking both writes were inside; the catalog "pairs … in one transaction" test never mentioned `$transaction`; "counted qty is 0" sent a blank cell; the public `GET /team-members` route had no hash-leak test; the Prisma mock lacked `receipt.findUnique` so `GET /receipts/:id` was untestable; six files re-stubbed `$transaction` identically. Suite: 216 → 224 tests, all green.
**Still weak (Open).** The mock's `$transaction` now also runs callback-form transactions, but still cannot express rollback; `JWT_SECRET` boot refusal, `CORS_EXTRA_ORIGINS`, `GET /receipts/:id`, `GET /admin/stats` happy path, team-member PATCH active toggle and `requireAnyAuth`'s "invalid token type" branch have no tests; `npx tsc --noEmit` does not type-check `tests/` or `scripts/` (`tsconfig.json` includes only `src` and `prisma`).

### 19. CLAUDE.md's iPad rules are not met by the shipped floor screen — confirmed, Open
**Evidence.** "48px min": `FloorApp.tsx:212` header button is `w-10 h-10` (40 px). "Product names 18px min, quantities 24px min": `ActivityFeed.tsx:94,98` (22 px, 14 px), `ConfirmBar.tsx:32-36` (14 px), `FloorStockHealth.tsx:117-121` (15 px). "Confirm button … full-width": `ConfirmBar.tsx:85-91` is `px-8` in a row beside the picker and Cancel (it is green and fixed-bottom). "No hover" and "30-second reset" hold.
**Cost.** Reviewers treat the rules as guarantees; they are not.
**Fix.** Decide whether the rule or the components change; either is a UI decision, so nothing was touched.

### 20. The design-token story does not cover the floor screen — confirmed, Open
`DESIGN_TOKENS.md:60` claims one accent (`indigo-*`), but `MemberSelect.tsx`, `PinPad.tsx`, `ProductCard.tsx`, `ProductGrid.tsx`, `CategoryTabs.tsx` use Tailwind's default `blue-*` and `StatCards.tsx` uses `blue-50`/`purple-50`; re-skinning the token ramp never touches Screen 1.

### 21. Rot: duplicates, dead code, stale values — confirmed, partly fixed in PR
**Removed in PR.** Vite template assets (`react.svg`, `vite.svg`, `hero.png`, `public/icons.svg`, the last of which shipped in every build), the stock `client/README.md`, unused `fetchRemovals`/`RemovalFilters`, an unused `.scroll-smooth` rule, two unused server exports and an unused default export.
**Still there (Open).**
- Server: `escapeCsvCell` ×3 (`adjustments.ts:18`, `thresholds.ts:20`, `catalog.ts:46`); CSV BOM builder ×3; pagination parse ×3; end-of-day date filter ×3; `Number(req.params.id)` ×5 with inconsistent integer checks (`/products/1.5` reaches Prisma → 500 while `teamMembers.ts:66` rejects it); bearer-token extraction ×4; the "Internal server error" literal ×30; `MAX_ROWS` 1000 in two importers vs 2000 in catalog; dead route `GET /receipts/:id` (no client caller, no test); `brandText` still declared as "transitional"; `scripts/mark-high-risk.ts` is a one-time script with hard-coded production ids and no "applied" marker; `seed.ts` writes the pack-size number into `currentQty` and never fills `packSize`/`uom`, and normalises brands without the merge map `backfill-brands.ts` uses.
- Client: `Chip` ×3, Chicago date formatter ×4, three fetch wrappers (`client.ts`, `adminClient.ts`, inline in `ActivityFeed.tsx`), `ZERO_CONFIRM_THRESHOLD` ×3, UOM list duplicated from `server/src/lib/measure.ts`, `TeamMember` ≡ `AdminTeamMember`; `ReceiptRecord.unitPrice` typed `number` but the wire value is a Decimal string, and `productCategory` is absent from the `POST /receipts` response; `<title>client</title>` is the production tab title; `FloorApp.tsx:192` uses a native `alert()` on the kiosk; admin fetch errors go only to `console.error`.
- Config: `@types/express ^5` with `express ^4`; `package.json#prisma.seed` is deprecated in Prisma 7; no `engines`/`.nvmrc`; `.gitignore` does not cover `.env.local`/`.env.production` variants; root `README.md` is two lines; no `client/.env.example` for `VITE_API_URL`; seven remote branches already merged into main are still on origin (not deleted, per your boundary).

### 22. Work done for no reason — confirmed (code), Open
`adminStats.ts:18-22,48-54` runs two raw queries over the same low-stock predicate (`lowStockCount` equals `lowStockProducts.length`) and awaits five independent queries sequentially; `adjustments.ts:181` and `thresholds.ts:151` call `rows.findIndex` inside the apply loop (O(n²) over up to 1000 rows); all three importers do one round-trip or transaction per row. Suspected only: `Removal`/`Receipt` have no index on `productId`/`createdAt` while `Adjustment` does. None of this matters at today's volume.

### 23. Security notes (not assessed, reported and left alone)
- An untracked local developer file (not in git, and deliberately not named here) still holds an admin password and a team JWT from early API testing. If that password is still live, rotate it and purge the file; the exact location was reported to you directly.
- `server/src/services/tokenService.ts:7-16` gates the public fallback secret on `ALLOW_DEV_SECRET`, not on `NODE_ENV=production`; a production env with that flag set would boot with a known secret. It is not set on Railway.
- `server/railway.json` builds with `npm install` and does not run `prisma migrate deploy` (migrations are manual, as the runbooks say).

### 24. Live state, for the record (all confirmed 2026-10-09)
Backend `/api/v1/health` → ok. Frontend bundle `index-C8bpxCs8.js` contains "High risk" and "Pack size", so Vercel is serving main HEAD (PRs #22 and #24). CORS pinned: preflight from `https://evil.example` returns no `Access-Control-Allow-Origin`. `GET /api/v1/team-members` returns 3 active members with only `id`, `name`, `initials`, `active`. Railway variable names set: `ALERT_FROM_EMAIL`, `ALERT_TO_EMAIL`, `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `PORT=3001`, `SENDGRID_API_KEY` (the three mail ones empty).

---

## What the PR contains (one fix per commit; see the branch log)

Code: Receive.tsx hook order (finding 3); `npm start` path (5); two unexported server symbols and an unused client helper, type and CSS rule (21). Docs: CLAUDE.md (15, plus five wording corrections from the fresh-context review of this branch), runbooks ×7 (16), agent files ×3 and DESIGN_TOKENS (17), seed and reset-script comments, receipts test header, `.env.example` (13), kickoff banner. Deletions: five template files (21). Tests: nine commits (18). Plus `AUDIT.md` and `docs/LESSONS.md`.

Before (origin/main): server 15 files / 216 tests pass; `tsc --noEmit` clean; client build clean; client lint 10 errors, 1 warning.
After: server 16 files / 224 tests pass; `tsc --noEmit` clean; client build clean; client lint 6 errors, 1 warning.

## Second pass: behaviour fixes (branch `UsmanRehans/audit-fixes`, stacked on the audit branch)

After the audit, the owner asked for the open findings to be fixed with everything kept working. Findings 1 (code side), 2, 4, 7, 8, 9, 10, 11, 12, 13 (code default) and 14 are fixed there, one commit each, with tests (server suite 216 → 256, client lint exits 0). Verification went beyond the mocked suite: a throwaway Postgres 16 in Docker was migrated and seeded (with the new guard), the worktree's server and client ran against it, and the flows were driven in the browser (login, dashboard, activity log, logout, forgot-password message, floor PIN entry and a removal) and with curl (JSON envelope, concurrent removals, receipt increment, Chicago "today", decimal threshold). A second fresh-context reviewer read the diff for regressions.

## What I did not get to

- Production configuration was not touched: the SendGrid variables (finding 1) and `ADMIN_BASE_URL` (13) still need to be set on Railway, and nothing has been deployed.
- Uncommitted work in your main checkout was deliberately not reviewed or touched; the audit branch is cut from `origin/main`.
- Vercel: environment (`VITE_API_URL`) and project settings were not checked. Railway: the service's root-directory setting (which decides whether `railway up` runs from the repo root) was not checked.
- Bundle size, accessibility and the `.claude/commands/*.md` prompt bodies (beyond path existence) were not reviewed.
- No Node engine pin was added; Vite 8 needs Node 20.19+ or 22.12+, and nothing in the repo says so.
