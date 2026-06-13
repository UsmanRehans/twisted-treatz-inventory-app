import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

interface CsvRow {
  "Raw Material": string;
  Category: string;
  Flavor: string;
  Packaging: string;
  Unit: string;
  "Weight (lbs)": string;
  Quantity: string;
  "Unit_1": string;
  " UOM ": string;
  Price: string;
  Brand: string;
  Item: string;
  "Purchased in": string;
}

function parsePrice(raw: string): number | null {
  if (!raw || raw.trim() === "") return null;
  const cleaned = raw.replace(/[$,]/g, "").trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function buildUnitSize(quantity: string, unit: string): string | null {
  const qty = quantity?.trim();
  const u = unit?.trim();
  if (!qty || !u || qty === "0") return null;
  return `${qty} ${u}`;
}

function cleanString(value: string | undefined | null): string | null {
  if (!value || value.trim() === "") return null;
  return value.trim();
}

async function main() {
  // Path to the CSV relative to this file: ../../data/raw_materials.csv
  const csvPath = resolve(__dirname, "../../data/raw_materials.csv");
  console.log(`Reading CSV from: ${csvPath}`);

  const csvContent = readFileSync(csvPath, "utf-8");

  // Parse CSV with proper quoting support
  const records: string[][] = parse(csvContent, {
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  // First row is the header
  const headers = records[0];
  console.log(`CSV headers: ${headers.join(" | ")}`);
  console.log(`Data rows found: ${records.length - 1}`);

  // Map header indices for reliable access
  const col = {
    name: 0,        // Raw Material
    category: 1,    // Category
    flavor: 2,      // Flavor
    packaging: 3,   // Packaging
    unit: 4,        // Unit (count)
    weight: 5,      // Weight (lbs)
    quantity: 6,    // Quantity (numeric value for unit size)
    unitLabel: 7,   // Unit (lb, oz, ea, etc.)
    uom: 8,         // UOM (e.g., "Bag/7lbs")
    price: 9,       // Price
    brand: 10,      // Brand
    item: 11,       // Item (usedIn)
    purchasedIn: 12, // Purchased in
  };

  const products = [];

  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    if (!row || row.length === 0) continue;

    const name = row[col.name]?.trim();
    if (!name) continue; // skip empty rows

    const category = row[col.category]?.trim() || "Uncategorized";
    const flavor = cleanString(row[col.flavor]);
    const quantity = row[col.quantity]?.trim() || "0";
    const unitLabel = row[col.unitLabel]?.trim() || "";
    const purchasedIn = row[col.purchasedIn]?.trim() || "Bag";
    const price = parsePrice(row[col.price] || "");
    const brand = cleanString(row[col.brand]);
    const usedIn = cleanString(row[col.item]);

    // Build unitSize from Quantity + Unit columns (e.g., "5 lb", "128 oz")
    const unitSize = buildUnitSize(quantity, unitLabel);

    // Parse currentQty from the Quantity column as an integer
    const currentQty = Math.max(0, Math.floor(parseFloat(quantity) || 0));

    products.push({
      name,
      category,
      flavor,
      purchaseUnit: purchasedIn,
      unitSize,
      brand,
      supplier: null, // CSV doesn't have a dedicated supplier column
      usedIn,
      currentQty,
      alertThreshold: 10,
      unitPrice: price,
      active: true,
    });
  }

  console.log(`\nParsed ${products.length} products. Inserting into database...`);

  // Clear existing products before seeding
  await prisma.receipt.deleteMany();
  await prisma.removal.deleteMany();
  await prisma.alertLog.deleteMany();
  await prisma.product.deleteMany();

  // Insert all products
  const result = await prisma.product.createMany({
    data: products,
  });

  console.log(`Inserted ${result.count} products successfully.`);

  // Verify by counting and showing category breakdown
  const total = await prisma.product.count();
  console.log(`\nVerification: ${total} products in database.`);

  const categories = await prisma.product.groupBy({
    by: ["category"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  console.log("\nProducts by category:");
  for (const cat of categories) {
    console.log(`  ${cat.category}: ${cat._count.id}`);
  }

  // ─── Seed Admin ─────────────────────────────────────────────────────
  // Credentials come from env, never hardcoded. Existing admin is left
  // untouched so re-running seed can never reset a live password.
  console.log("\n--- Seeding admin user ---");
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@twistedtreatz.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  const existingAdmin = await prisma.admin.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`Admin ${adminEmail} already exists — left unchanged.`);
  } else if (!adminPassword) {
    console.warn(
      "SEED_ADMIN_PASSWORD not set and no admin exists — skipping admin seed. " +
        "Set SEED_ADMIN_PASSWORD to create the initial admin.",
    );
  } else {
    await prisma.admin.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        name: process.env.SEED_ADMIN_NAME ?? "Admin",
      },
    });
    console.log(`Admin user created: ${adminEmail}`);
  }

  // ─── Seed Team Members ─────────────────────────────────────────────
  // Names only — PINs are assigned by the admin via the dashboard after
  // seeding, so no credential ever lives in source. Skips if members
  // already exist, so the audit log (removals) is never wiped.
  console.log("\n--- Seeding team members ---");
  const existingMemberCount = await prisma.teamMember.count();
  if (existingMemberCount > 0) {
    console.log(`${existingMemberCount} team members already exist — skipping.`);
  } else {
    const teamMembers = [
      { name: "Maria R", initials: "MR" },
      { name: "James T", initials: "JT" },
      { name: "Sofia L", initials: "SL" },
      { name: "David K", initials: "DK" },
      { name: "Ashley M", initials: "AM" },
      { name: "Carlos P", initials: "CP" },
    ];

    // Random one-time PIN per member; printed once so the admin can
    // distribute them, then changed by each member on first use.
    for (const member of teamMembers) {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      await prisma.teamMember.create({
        data: {
          name: member.name,
          initials: member.initials,
          pinHash: await bcrypt.hash(pin, 12),
          active: true,
        },
      });
      console.log(`  ${member.name} (${member.initials}) — temporary PIN: ${pin}`);
    }
    console.log(`\nSeeded ${teamMembers.length} team members with random temporary PINs.`);
    console.log("Distribute these PINs securely, then reset them from the admin dashboard.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Seed error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
