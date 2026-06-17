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
- `products` — all SKUs with category, unit, brand, supplier, current_qty, alert_threshold
- `users` — 6 team members with name, PIN hash, active flag
- `admin` — single admin record with email, password hash
- `removals` — log of every removal: user_id, product_id, qty, timestamp
- `receipts` — log of every shipment received: product_id, expected_qty, actual_qty, supplier, admin_id, timestamp

## Alert Rules
- Email fires when any product qty drops AT OR BELOW its threshold
- Alert sent to master admin email only
- One alert per product per day (no spam)
- SendGrid for delivery

## Invariants — every change is checked against these
- Stock changes are transactional: qty update + audit record (Removal/Receipt) commit together, with qtyBefore/qtyAfter snapshots on removals
- Stock never goes negative; removals exceeding currentQty are rejected
- Receipts increment stock by ACTUAL counted qty, never the PO's expected qty
- Team members can only remove stock; only admins can add stock
- Auth surface: everything requires a token EXCEPT `GET /team-members` (member-select screen), `POST /auth/*`, `GET /health`. Reads accept admin OR team tokens (`requireAnyAuth`); writes are role-specific
- `pinHash` / `passwordHash` never appear in any API response
- Both login flows are rate limited (5 attempts / 15 min, in-memory; expired entries are swept so the map can't grow unbounded)
- Admin password change/reset revokes all outstanding admin JWTs: tokens carry a `tokenVersion` claim checked against `Admin.tokenVersion` on every admin-authed request (tokens minted before the claim count as 0); change-password returns a fresh token so the changing session stays signed in
- Reset-token consumption is atomic: validate + consume happen in one `updateMany` (no find-then-update race)
- `JWT_SECRET` must be set in production — the server refuses to boot without it
- Alerts fire at-or-below threshold, max once per product per day

## Testing — run before claiming anything works
- `cd server && npm test` — vitest + supertest suite in `server/tests/` (auth matrix, login flows, stock math, alert rules). Prisma is mocked via the shared client in `server/src/lib/prisma.ts` — always import `prisma` from there, never `new PrismaClient()`
- `cd server && npx tsc --noEmit` — server types
- `cd client && npm run build` — client types + build
- New invariant-touching code needs a test in `server/tests/` before it ships

## Agent roster
- **Active**: `rick` (product owner + mad-scientist inventory systems expert — owns what/why, designs schemas, models data, builds features — run via `/rick`), `qa-agent` (verifies every change — run via `/qa`), `security-agent` (cybersecurity audits — run via `/security-sweep`)
- **Retired blueprints**: `database-agent`, `auth-agent`, `alert-agent`, `ipad-ui-agent`, `admin-agent` were build-time specs for the original construction (see `docs/MASTER_KICKOFF_PROMPT.md`). They describe intent, not current state — useful as reference, don't re-run them

### Workflow — Rick decides first
Rick is the product owner. For any **new feature or structural/architectural change**, consult Rick BEFORE writing code — he owns the what/why, makes the product call, and designs. Then build, then verify with qa-agent (and security-agent if auth/data exposure is touched). Pure mechanical edits, bug fixes, and explicit user instructions don't need a Rick consult.

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
```
/
├── CLAUDE.md                  ← you are here
├── .claude/
│   ├── agents/                ← subagent definitions
│   └── commands/              ← custom slash commands
├── client/                    ← React frontend (Vite)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── FloorApp.tsx   ← Screen 1: iPad removal UI
│   │   │   ├── Admin.tsx      ← Screen 2: Admin dashboard
│   │   │   └── Receive.tsx    ← Screen 3: Receiving UI
│   │   ├── components/
│   │   └── api/               ← API client functions
├── server/                    ← Node/Express backend
│   ├── routes/
│   ├── middleware/
│   ├── prisma/
│   └── services/
│       └── alerts.ts          ← SendGrid email alerts
└── docs/                      ← Project documentation
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
