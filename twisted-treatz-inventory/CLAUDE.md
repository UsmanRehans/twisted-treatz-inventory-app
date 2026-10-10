# Twisted Treatz — Inventory App

## Project Overview
Internal inventory management system for a candy distribution/manufacturing company in Houston, TX.
This is NOT a storefront. No customer-facing pages. No Shopify. No checkout.
This is a private tool used exclusively by the owner and 6 team members.

## Business Context
- Company: Twisted Treatz (twistedtreatz.com)
- Location: Houston, TX
- Products: 200+ candy/ingredient SKUs across categories: Raw Materials, Gummy, Jelly Beans, Caramel Chews, Swedish Bubs, Sour Candy, Hard Candy, Candy Corn, etc.
- Team: 1 master admin (owner) + 6 floor team members

## Three Screens — Never Confuse Them

### Screen 1: iPad Removal UI (`/app` route)
- Mounted on iPad physically next to the inventory machine on the floor
- Team members select their name → browse products by category → tap product → +/- qty → confirm removal
- Must be touch-friendly: large tap targets (min 48px), no hover states, big fonts
- Shows real-time stock levels and flags low-stock items visually
- NO ability to add stock from this screen

### Screen 2: Admin Dashboard (`/admin` route)
- Desktop browser, password protected (master admin only)
- View all 200+ SKUs, current quantities, alert thresholds
- Edit thresholds per product inline
- View full activity log (who removed what, when)
- Manage 6 team member accounts and PINs
- View category summary stats

### Screen 3: Receiving UI (`/admin/receive` route)
- Admin only — deliberate, slow, mistake-resistant UI
- Form: select product → enter PO expected qty → enter actual counted qty → re-enter actual qty to confirm (must match) → submit
- Double-entry verification prevents receiving errors
- Logs: date, product, supplier, expected vs actual, admin name

## Tech Stack
- **Frontend**: React (Vite) with TailwindCSS
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (via Prisma ORM)
- **Auth**: JWT tokens, bcrypt password hashing
- **Email alerts**: SendGrid (free tier)
- **Hosting**: Vercel (frontend) + Railway (backend + DB)

## User Roles & Permissions
| Role | Access | Auth Method |
|------|--------|-------------|
| Master Admin | All 3 screens | Email + password |
| Team Member | Screen 1 only | Name tap + 4-digit PIN |

## Database Key Tables
Source of truth is `server/prisma/schema.prisma`. Tables are PascalCase and columns camelCase (Prisma defaults), e.g. `"Product"."currentQty"` in raw SQL.
- `Product` — every SKU: name, category, flavor, purchaseUnit, unitSize (legacy free text), packSize + uom, brandId → Brand (plus the transitional `brandText` column, still present), supplier, usedIn, currentQty, alertThreshold, unitPrice, active (soft delete), highRisk (visual label)
- `Brand` — first-class brand: name (unique, normalized), active
- `TeamMember` — floor team: name, initials, pinHash, active
- `Admin` — one or more admins: email (unique, must be @twistedtreatz.com), passwordHash, name, resetTokenHash/resetTokenExpires, tokenVersion
- `Removal` — every floor removal: productId, teamMemberId, qty, qtyBefore, qtyAfter, createdAt
- `Receipt` — every shipment received: productId, adminId, supplier, expectedQty, actualQty, unitPrice, notes, createdAt
- `Adjustment` — admin stock corrections (cycle count, bulk CSV, catalog import): productId, adminId, delta, qtyBefore, qtyAfter, reason, batchId, createdAt
- `AlertLog` — productId + sentAt; backs the one-alert-per-product-per-day rule

## Alert Rules
- Email fires when a floor removal leaves a product AT OR BELOW its threshold (`server/src/services/alertService.ts`, called only from the removals route). Admin bulk updates, threshold imports and catalog imports never email; they flag low stock in their own result summary
- Sent to the `ALERT_TO_EMAIL` address from `ALERT_FROM_EMAIL` (env vars, not the Admin row's email). If `SENDGRID_API_KEY`, `ALERT_FROM_EMAIL` or `ALERT_TO_EMAIL` is unset, nothing is emailed but the AlertLog row is still written
- One alert per product per calendar day (UTC day boundaries), enforced via `AlertLog`
- SendGrid for delivery

## Invariants — every change is checked against these
- Stock changes are transactional: qty update + audit record (Removal/Receipt/Adjustment) commit together, with qtyBefore/qtyAfter snapshots on removals and adjustments
- Stock never goes negative; removals exceeding currentQty are rejected
- Receipts increment stock by ACTUAL counted qty, never the PO's expected qty
- Team members can only remove stock; only admins can add stock
- Auth surface: everything requires a token EXCEPT `GET /team-members` (member-select screen), the login / forgot-password / reset-password endpoints under `POST /auth/*` (`POST /auth/admin/change-password` needs an admin token), and `GET /api/v1/health`. Product, brand and removal reads accept admin OR team tokens (`requireAnyAuth`); receipts, admin stats/activity and the CSV exports are admin-only; writes are role-specific
- `pinHash` / `passwordHash` never appear in any API response
- Both login flows are rate limited (5 attempts / 15 min, in-memory; expired entries are swept so the map can't grow unbounded)
- Admin password change/reset revokes all outstanding admin JWTs: tokens carry a `tokenVersion` claim checked against `Admin.tokenVersion` on every admin-authed request (tokens minted before the claim count as 0); change-password returns a fresh token so the changing session stays signed in
- Reset-token consumption is atomic: validate + consume happen in one `updateMany` (no find-then-update race)
- `JWT_SECRET` must be set in production — the server refuses to boot without it
- Admin emails must be exactly `@twistedtreatz.com` (no subdomains/lookalikes): any writer of an admin email must call `isAllowedAdminEmail` from `server/src/lib/adminEmailPolicy.ts` (today only the seed script writes one)
- Browser CORS is pinned: prod frontend origin + localhost in dev (`CORS_EXTRA_ORIGINS` env var for anything else)
- Alerts fire at-or-below threshold on floor removals, max once per product per calendar day (UTC day boundaries)

## Testing — run before claiming anything works
- `cd server && npm test` — vitest + supertest suite in `server/tests/` (auth matrix, login flows, stock math, alert rules). Prisma is mocked via the shared client in `server/src/lib/prisma.ts` — always import `prisma` from there, never `new PrismaClient()`
- `cd server && npx tsc --noEmit` — server types
- `cd client && npm run build` — client types + build
- New invariant-touching code needs a test in `server/tests/` before it ships

## Agent roster
- **Active**: `rick` (product owner + mad-scientist inventory systems expert — owns what/why, designs schemas, models data, builds features — run via `/rick`), `isaiah` (software architect — owns the technical HOW: data model integrity, API contracts, transactions, auth architecture, migrations, deploy topology — run via `/isaiah`), `gideon` (access & identity manager — creates/resets/deactivates team-member + admin accounts, owns the auth/permission surface — run via `/gideon`), `avery` (data analyst — read-only analysis of inventory data: trends, stock health, reorder points; asks clarifying questions, explains clearly — run via `/avery`), `james` (QA engineer — verifies every change — run via `/james` or `/qa`), `zahid` (security engineer — cybersecurity audits — run via `/zahid` or `/security-sweep`)
- **Division of labor**: Rick = what/why (product) · Isaiah = how (architecture) · Gideon = who (users/access) · Avery = what the data says (analysis) · James + Zahid = verification (QA + security)
- **Retired blueprints**: `database-agent`, `auth-agent`, `alert-agent`, `ipad-ui-agent`, `admin-agent` were build-time specs for the original construction (see `docs/MASTER_KICKOFF_PROMPT.md`). They describe intent, not current state — useful as reference, don't re-run them

### Workflow — Rick decides first
Rick is the product owner. For any **new feature or structural/architectural change**, consult Rick BEFORE writing code — he owns the what/why, makes the product call, and designs. Then build, then verify with James (`/qa`) — and Zahid (`/security-sweep`) if auth/data exposure is touched. Pure mechanical edits, bug fixes, and explicit user instructions don't need a Rick consult.

## Code Standards
- ESM imports only (no require())
- TypeScript preferred
- Prettier formatting on every save
- All API routes prefixed with /api/v1/
- All responses: { success: boolean, data: any, error?: string }
- Never expose PIN hashes or password hashes in API responses
- All timestamps stored as UTC in DB, displayed in America/Chicago timezone

## iPad-Specific Rules
- All interactive elements minimum 48px tall
- No hover-dependent interactions
- Font sizes: product names 18px min, quantities 24px min
- Confirm button always green, always full-width at bottom of screen
- Screen auto-resets to member selection after 30 seconds of inactivity

## File Structure
The git repository root holds only README.md and this `twisted-treatz-inventory/` folder.
```
twisted-treatz-inventory/
├── CLAUDE.md                      ← you are here
├── .claude/
│   ├── agents/                    ← subagent definitions (rick, isaiah, gideon, avery, james, zahid)
│   └── commands/                  ← custom slash commands
├── client/                        ← React frontend (Vite + Tailwind v4)
│   └── src/
│       ├── pages/
│       │   ├── FloorApp.tsx       ← Screen 1: iPad removal UI
│       │   ├── Admin.tsx          ← Screen 2: Admin dashboard
│       │   ├── Receive.tsx        ← Screen 3: Receiving UI
│       │   ├── AdminLogin.tsx, ForgotPassword.tsx, ResetPassword.tsx
│       ├── components/admin/      ← dashboard tabs and modals
│       ├── components/floor/      ← iPad screen pieces
│       ├── api/                   ← client.ts (floor) + adminClient.ts (admin)
│       ├── hooks/useAdminAuth.ts
│       └── lib/                   ← csv.ts (own CSV parser), sheet.ts (lazy SheetJS)
├── server/                        ← Node/Express backend
│   ├── src/
│   │   ├── app.ts, index.ts
│   │   ├── routes/                ← auth, products, brands, removals, receipts, adjustments, catalog, thresholds, teamMembers, adminStats
│   │   ├── middleware/            ← requireAdmin, requireTeamMember, requireAnyAuth
│   │   ├── services/              ← alertService.ts (SendGrid), emailTemplates.ts, passwordResetService.ts, tokenService.ts
│   │   └── lib/                   ← prisma.ts (shared client), adminEmailPolicy.ts, brand.ts, measure.ts
│   ├── prisma/                    ← schema.prisma, migrations/, seed.ts
│   ├── scripts/                   ← one-off operational scripts (see docs/)
│   └── tests/                     ← vitest + supertest suite
├── data/raw_materials.csv         ← original catalogue used by the seed
└── docs/                          ← runbooks and the original kickoff prompt
```

## Current Data
- 204 SKUs already catalogued in twisted_treatz_inventory.xlsx
- Categories: Raw material, Gummy, Jelly Beans, Caramel Chews, Swedish Bubs, Sour Candy, Hard Candy, Candy Corn, Jelly, Sweet Candy, Spicy Candy
- Suppliers include: Sam's Club, Webstaurant, Costco, HEB, Target, Katom, Bakell, Albanese Direct, etc.

## Build Order (follow this sequence)
1. Database schema + Prisma setup
2. Seed script (import 204 SKUs from CSV)
3. Auth system (admin login + team member PIN)
4. Products API (CRUD)
5. Removals API
6. Receipts API
7. Alert service (SendGrid)
8. Screen 1: iPad UI
9. Screen 2: Admin Dashboard
10. Screen 3: Receiving UI
11. Deploy (Vercel + Railway)
