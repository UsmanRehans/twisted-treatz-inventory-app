// One-time: apply Hani's "high risk" list (2026-10-05).
//
//   npx tsx --env-file=.env scripts/mark-high-risk.ts           # dry run
//   npx tsx --env-file=.env scripts/mark-high-risk.ts --apply   # write
//
// 1. Sets highRisk=true on every ACTIVE product matching the list. Family
//    names ("Salt Water Taffy", "Gummy Bear") match every flavor via a
//    case-insensitive contains; specific items are pinned by id.
// 2. Creates the items not yet in the catalog. Per the create invariant they
//    land at qty 0; a PLACEHOLDER random qty is then written through an
//    audited Adjustment so Hani can recount and correct it.
// Idempotent: re-running skips products already flagged / already created.

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ADMIN_EMAIL = "usman@twistedtreatz.com";

// Every active flavor of these families.
const FAMILIES = [
  "Fruit Jelly",
  "Caramel Chews",
  "Fruit Slices",
  "Salt Water Taffy",
  "Swedish Style",
  "Swedish Bubs", // all currently inactive — handled below
  "Gummy Bear",
];

// Single items already in the catalog (Hani's name → product id).
const EXISTING_IDS: Record<string, number> = {
  "Honey Sesame Sticks": 610, // Honey Roasted Sesame Sticks
  "Peanut Brittle": 602,
  "Wax Bottles": 289,
  "Chamoy Pickle Kit": 684, // Alamo Big Tex Pickle in Chamoy
  "Cherry Jelly Hearts": 498,
  "Cinnamon Ju Ju Hearts": 499,
  "Mixed Nuts & Seeds Snack Blend": 615, // Nuts & Seed Mix
  "Roasted Salted Mixed Nuts": 629,
  "Butter Toffee Almonds": 607,
  "Butter Toffee Cashews": 609,
  "Butter Toffee Pecans": 608,
  "Sugar Free Gummy Bears": 580,
  "Sugar Free Gummy Worms": 271,
  "Honey Roasted Cashews": 617,
  "Claey's Drops Wild Cherry": 648,
};

const NEW_ITEMS: { name: string; category: string }[] = [
  { name: "Coffee Delight Hard", category: "Hard Candy" },
  { name: "Soft Peppermint Puffs Candy", category: "Hard Candy" },
  { name: "Fruit Starlight Hard Candy", category: "Hard Candy" },
  { name: "Peppermint Mint Balls Hard", category: "Hard Candy" },
  { name: "Peppermint Twists Hard", category: "Hard Candy" },
  { name: "Sour Fruit Balls Hard Candy", category: "Hard Candy" },
  { name: "Root Beer Hard Candy Barrels", category: "Hard Candy" },
  { name: "Assorted Lollipops Fruity Hard", category: "Hard Candy" },
  { name: "Tropical Snack Mix Sweet Salty Total", category: "Nuts & Dried Fruit" },
];

const randomQty = () => 5 + Math.floor(Math.random() * 16); // 5–20

async function main() {
  console.log(APPLY ? "=== APPLY ===" : "=== DRY RUN (pass --apply to write) ===");

  const toFlag = new Map<number, string>();

  for (const family of FAMILIES) {
    const rows = await prisma.product.findMany({
      where: { name: { contains: family, mode: "insensitive" }, active: true },
      select: { id: true, name: true },
    });
    if (rows.length === 0) console.log(`  ! no ACTIVE products for "${family}"`);
    for (const r of rows) toFlag.set(r.id, r.name);
  }

  for (const [label, id] of Object.entries(EXISTING_IDS)) {
    const p = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true, active: true } });
    if (!p) throw new Error(`Product #${id} (${label}) not found`);
    if (!p.active) console.log(`  ! #${id} ${p.name} is inactive (flagging anyway)`);
    toFlag.set(p.id, p.name);
  }

  const already = await prisma.product.findMany({
    where: { id: { in: [...toFlag.keys()] }, highRisk: true },
    select: { id: true },
  });
  const alreadySet = new Set(already.map((a) => a.id));
  const pending = [...toFlag].filter(([id]) => !alreadySet.has(id));

  console.log(`\nFlag high risk: ${pending.length} (${alreadySet.size} already flagged)`);
  for (const [id, name] of pending.sort((a, b) => a[1].localeCompare(b[1]))) {
    console.log(`  #${id} ${name}`);
  }

  const admin = await prisma.admin.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
  if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} not found`);

  const creates: { name: string; category: string; qty: number }[] = [];
  for (const item of NEW_ITEMS) {
    const exists = await prisma.product.findFirst({
      where: { name: { equals: item.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (exists) {
      console.log(`  = "${item.name}" already exists (#${exists.id}) — will just flag`);
      if (!alreadySet.has(exists.id)) pending.push([exists.id, item.name]);
      continue;
    }
    creates.push({ ...item, qty: randomQty() });
  }
  console.log(`\nCreate: ${creates.length}`);
  for (const c of creates) console.log(`  + ${c.name} [${c.category}] placeholder qty ${c.qty}`);

  if (!APPLY) return;

  const batchId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.product.updateMany({
      where: { id: { in: pending.map(([id]) => id) } },
      data: { highRisk: true },
    });
    for (const c of creates) {
      const p = await tx.product.create({
        data: {
          name: c.name,
          category: c.category,
          purchaseUnit: "Each",
          alertThreshold: 2,
          highRisk: true,
          currentQty: 0,
        },
      });
      await tx.adjustment.create({
        data: {
          productId: p.id,
          adminId: admin.id,
          delta: c.qty,
          qtyBefore: 0,
          qtyAfter: c.qty,
          reason: "PLACEHOLDER qty — Hani's high-risk list; needs a real count",
          batchId,
        },
      });
      await tx.product.update({ where: { id: p.id }, data: { currentQty: c.qty } });
    }
  });
  console.log(`\nDone. Adjustment batchId ${batchId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
