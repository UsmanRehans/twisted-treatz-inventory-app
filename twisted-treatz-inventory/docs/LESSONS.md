# Lessons

Things learned about this repo that were not written down anywhere. One lesson per heading, summary line first. Update a heading rather than adding a duplicate.

## Production has never been able to send email
SendGrid has never been configured on the Railway backend, so low-stock alerts and password-reset emails have never gone out, while the app behaves as if they had.
`SENDGRID_API_KEY`, `ALERT_FROM_EMAIL` and `ALERT_TO_EMAIL` exist on Railway as empty strings (checked 2026-10-09). Until the 2026-10 fixes `alertService` wrote the `AlertLog` row and logged `Low stock alert sent` even when it skipped the send, so neither the logs nor the dedupe table showed that mail was off; it now logs `Low stock NOT emailed` and records nothing, and the forgot-password route answers 503. Check the boot lines `Email alerts are disabled` / `Reset emails are disabled` in `railway logs` before trusting any alert claim.

## `npm run db:seed` is a wipe, and local `.env` is production
The seed deletes the whole catalogue and all movement history before inserting; until 2026-10 nothing stopped it running against production except the `Adjustment.productId` RESTRICT foreign key, which fired after receipts/removals/alert logs were already gone.
It now refuses to run with `NODE_ENV=production` or unless `SEED_ALLOW_WIPE` equals the `DATABASE_URL` host, and deletes in one transaction. Still treat it as destructive: point `DATABASE_URL` at a throwaway database first. (AUDIT.md finding 2.)

## `.claude/` is ignored by the developer's global gitignore
Files under `twisted-treatz-inventory/.claude/` only reach the repo with `git add -f`; new agent or command files silently stay local.
This is why CLAUDE.md referred to "retired blueprint" agents and `/ipad-check`, `/status` commands that a fresh clone does not have. The tracked set is six agents and eight commands; check `git ls-files twisted-treatz-inventory/.claude` before pointing anyone at a file there.

## Client lint was red from the first commit until 2026-10
`eslint-plugin-react-hooks` v7's recommended config (`set-state-in-effect`, `rules-of-hooks`, `set-state-in-render`) has been on since `13da445`, and `npm run lint` never exited 0 until the audit fixes.
It is now part of the pre-merge checks in CLAUDE.md. The v7 rules reject `setState` directly inside an effect body; the fixes used derived state (a "loaded for key" value instead of a `loading` flag), render-time prop comparison (PinPad) and initializer-based reads (useAdminAuth). Reach for those patterns rather than disabling the rule.

## Verify against a throwaway Postgres, never the shared one
Docker is on the dev machine, so the full stack can be exercised locally in a few minutes: `docker run -d --name tt-pg -e POSTGRES_USER=x -e POSTGRES_PASSWORD=y -e POSTGRES_DB=tt -p 55432:5432 postgres:16-alpine`, then in `server/` with `DATABASE_URL=postgresql://x:y@localhost:55432/tt` run `npx prisma migrate deploy` and `SEED_ALLOW_WIPE=localhost NODE_ENV=development SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npx prisma db seed`, start the API with `JWT_SECRET` set and `npx tsx watch src/index.ts`, and run the client with `npm run dev` (its proxy targets port 3001).
This is how the audit fixes were verified (concurrent removals, Chicago "today", login/logout, floor PIN flow) without `.env` ever pointing at production. The seed prints temporary PINs for the six members; `scripts/reset-admin-password.ts` sets a known admin password.

## Production starts the server from `railway.json`, not `npm start`
`railway.json` `startCommand` and `Procfile` run `node dist/src/index.js`; `npm start` pointed at a non-existent `dist/index.js` for months without anyone noticing.
`tsc` emits under `dist/src/` because `tsconfig.json` has `rootDir: "."` and also compiles `prisma/`. Fixed in the audit PR, but if the three ever disagree again, Railway's file is the one that matters.

## Day boundaries are Chicago calendar days, computed in one place
Until 2026-10 alert dedupe, the dashboard's "removed today" and every date-range filter used `setUTCHours`, so the business day rolled over at 7 pm CDT / 6 pm CST while the UI formatted everything in Chicago time and hid it.
All five call sites now go through `server/src/lib/businessDay.ts` (`chicagoDayBounds`, `parseChicagoDate`), whose tests pin the two daylight-saving days. Add any new "per day" logic there, not inline.

## The Prisma mock cannot prove rollback
`tests/helpers/mockPrisma.ts` implements `$transaction` as `Promise.all(ops)`, and every mocked write resolves when called, before the "transaction" runs.
A test can pin that both writes are in the one `$transaction` array (op-list length, now asserted), but a "fails atomically" test would pass or fail for the wrong reasons. Real rollback semantics need a different helper.

## The server tests depend on vitest's default per-file isolation
There is no vitest config, so each test file runs in its own process with mock implementations kept across `vi.clearAllMocks()`.
`tests/alerts.test.ts` stubs the SendGrid env with `vi.hoisted`, `auth.ts`'s `loginAttempts` map is module-level, and the shared `$transaction` implementation in `tests/helpers/mockPrisma.ts` is relied on by six files. Turning on `--no-isolate`, `mockReset` or `restoreMocks` would break all three in confusing ways; add a config file deliberately if that ever changes.

## Rate-limit tests share one source IP
supertest uses the same IP for every request in a file, and admin login limits by email AND IP, so earlier tests spend the IP budget.
Clear the exported `loginAttempts` map in `beforeEach` (done in the audit PR); without it the only honest assertion is "401 or 429".

## In the catalog importer, a blank Qty means 0
For a matched existing product an empty Qty cell is treated as a count of 0 and applied (with an Adjustment), not skipped; blank category/brand/pack/uom cells are skipped.
The runbook used to say the opposite. The typed-`ZERO` confirmation only triggers at 20 or more zeroed rows, so a half-filled sheet with fewer blanks goes straight through.

## Admin auth state is per hook instance
`useAdminAuth` keeps the token in a `useState` inside each component that calls it, so the sidebar's `logout()` clears storage but not the page's copy; the dashboard stays usable until a reload.
Any component that guards on `isAuthenticated` must also put that guard below every hook: the receiving page crashed with "Rendered fewer hooks than expected" when the token expired because its `<Navigate>` return sat above four hooks.

## Checking production claims without touching secrets
`railway variables --service twisted-treatz-backend --environment production --json` piped through a script that prints only variable names and lengths answers "is X configured" without exposing values; `railway logs` greps for `[AlertService]` lines show what the alert path actually did.
For the frontend, `curl -s https://inventory.twistedtreatz.com | grep -o 'assets/index-[^"]*\.js'` then grepping that bundle for a feature string (e.g. `High risk`) confirms which commit Vercel is serving; `GET /api/v1/team-members` is the one public endpoint and doubles as a hash-leak check.
