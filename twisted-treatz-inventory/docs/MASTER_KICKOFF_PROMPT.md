# MASTER KICKOFF PROMPT
# Copy everything below this line and paste it into Claude Code

---

You are the lead developer for the Twisted Treatz Inventory App.
Read CLAUDE.md now — it contains everything you need to know about this project.

## Your first task: Scaffold the entire project

Create the full project structure as defined in CLAUDE.md file structure section.

Then do the following in order:

1. Initialize the project:
   - Create /client with Vite + React + TypeScript + TailwindCSS
   - Create /server with Node.js + Express + TypeScript
   - Create /server/prisma with the schema from the database-agent
   - Set up .env.example with all required environment variables
   - Set up package.json scripts: dev, build, start, db:migrate, db:seed

2. Copy the inventory CSV data:
   - Place the raw_materials.csv at /data/raw_materials.csv
   - The CSV has 204 rows with columns: Raw Material, Category, Flavor, Packaging, Unit, Weight (lbs), Quantity, Unit, UOM, Price, Brand, Item, Purchased in

3. Set up the database:
   - Use the database-agent to create prisma/schema.prisma
   - Create the seed script that imports all 204 products from the CSV
   - Run migrations

4. Build the auth system:
   - Use the auth-agent to build admin JWT auth and team member PIN auth

5. Build all API routes:
   - GET/POST/PATCH /api/v1/products
   - GET/POST /api/v1/removals
   - GET/POST /api/v1/receipts
   - GET/PATCH /api/v1/team-members
   - GET /api/v1/admin/stats
   - POST /api/v1/auth/admin/login
   - POST /api/v1/auth/team/verify

6. Build the alert service using the alert-agent

7. Build Screen 1 (iPad UI) using the ipad-ui-agent

8. Build Screen 2 (Admin Dashboard) using the admin-agent

9. Build Screen 3 (Receiving UI) at /admin/receive:
   - Product select dropdown (searchable)
   - Expected qty field (from PO)
   - Actual qty field (counted by hand)
   - Re-enter actual qty (must match — validation before submit)
   - Supplier field
   - Submit button (disabled until both qty fields match)
   - Success confirmation with undo option (60 second window)

10. Final checks:
    - Run /ipad-check to verify touch targets
    - Run /status to confirm everything is wired up
    - Generate a README.md with: setup instructions, env vars needed, how to deploy to Vercel + Railway

## Constraints — never violate these
- No Shopify integration
- No customer-facing pages
- No checkout or payment of any kind
- Team members can ONLY remove stock from Screen 1
- Only admin can add stock (Screen 3)
- PIN hashes and password hashes NEVER appear in API responses
- All monetary values use Decimal not Float
- All timestamps display in America/Chicago timezone

When you hit a decision point where you're unsure, check CLAUDE.md first.
If CLAUDE.md doesn't cover it, ask me before proceeding.

Let's build it. Start with step 1.
