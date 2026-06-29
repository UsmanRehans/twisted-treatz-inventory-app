// One-shot brand backfill. Promotes the transitional Product.brandText
// free-text values into the Brand table and links Product.brandId.
//
// Run MANUALLY, once, against prod — see docs/BRAND_MIGRATION.md for the
// ordered runbook. Defaults to --dry-run (no writes); pass --apply to write.
//
//   npx tsx --env-file=.env scripts/backfill-brands.ts            # dry-run
//   npx tsx --env-file=.env scripts/backfill-brands.ts --apply    # writes
//
// Reads the human-approved dedupe map from scripts/brand-merge-map.json,
// which you build by reviewing the dry-run audit output.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";
import { normalizeBrandName } from "../src/lib/brand.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface MergeMap {
  canonical: Record<string, string>;
  dropToNull: string[];
}

function loadMergeMap(): MergeMap {
  const raw = readFileSync(resolve(__dirname, "brand-merge-map.json"), "utf-8");
  const parsed = JSON.parse(raw);
  return {
    canonical: parsed.canonical ?? {},
    dropToNull: (parsed.dropToNull ?? []).map((s: string) => s.toLowerCase()),
  };
}

// Resolve a raw brandText value to its canonical Brand name, or null for "no
// brand". Merge map wins over the default normalizer.
function resolveBrand(raw: string | null, map: MergeMap): string | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === "" || map.dropToNull.includes(key)) return null;
  if (map.canonical[key]) return map.canonical[key];
  return normalizeBrandName(raw);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const map = loadMergeMap();

  console.log(`\n=== Brand backfill (${apply ? "APPLY — WILL WRITE" : "dry-run"}) ===\n`);

  // 1. Audit: every product with a raw brand value.
  const products = await prisma.product.findMany({
    select: { id: true, brandText: true },
  });
  const total = products.length;
  const withBrandText = products.filter((p) => (p.brandText ?? "").trim() !== "");

  // 2. Build raw→canonical resolution and tally.
  const rawCounts = new Map<string, number>();
  const canonicalForRaw = new Map<string, string | null>();
  for (const p of withBrandText) {
    const raw = p.brandText as string;
    rawCounts.set(raw, (rawCounts.get(raw) ?? 0) + 1);
    if (!canonicalForRaw.has(raw)) canonicalForRaw.set(raw, resolveBrand(raw, map));
  }

  const canonicalNames = new Set<string>();
  let toNull = 0;
  for (const [raw, canon] of canonicalForRaw) {
    if (canon === null) toNull += rawCounts.get(raw) ?? 0;
    else canonicalNames.add(canon);
  }

  // 3. Report.
  console.log(`Products total:            ${total}`);
  console.log(`With a brandText value:    ${withBrandText.length}`);
  console.log(`Distinct raw brand values: ${rawCounts.size}`);
  console.log(`→ Distinct canonical brands: ${canonicalNames.size}`);
  console.log(`→ Rows resolving to NO brand (null): ${toNull}\n`);

  console.log("Raw value → canonical (count):");
  for (const [raw, count] of [...rawCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const canon = canonicalForRaw.get(raw);
    console.log(`  ${JSON.stringify(raw)} → ${canon === null ? "(null)" : JSON.stringify(canon)}  [${count}]`);
  }
  console.log("");

  if (!apply) {
    console.log("Dry-run only. Review the mapping above, adjust brand-merge-map.json,");
    console.log("then re-run with --apply.\n");
    return;
  }

  // 4. Upsert brands, cache name→id.
  const brandIdByName = new Map<string, number>();
  for (const name of canonicalNames) {
    const brand = await prisma.brand.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true },
    });
    brandIdByName.set(name, brand.id);
  }

  // 5. Link products in one transaction (all-or-nothing). Generous timeout:
  //    sequential updates over a remote connection blow past Prisma's 5s
  //    interactive-transaction default (P2028).
  await prisma.$transaction(
    async (tx) => {
      for (const p of withBrandText) {
        const canon = canonicalForRaw.get(p.brandText as string) ?? null;
        const brandId = canon === null ? null : (brandIdByName.get(canon) ?? null);
        await tx.product.update({ where: { id: p.id }, data: { brandId } });
      }
    },
    { timeout: 120_000, maxWait: 30_000 }
  );

  // 6. Verify: no row with a MEANINGFUL brandText should be left unlinked.
  //    The DB count below catches every null-brandId row that still has a
  //    non-null brandText — which legitimately includes both the intentional
  //    drops (toNull) AND whitespace-only values (excluded from withBrandText
  //    above). Expected null total accounts for both so the check is exact.
  const whitespaceOnly = products.filter(
    (p) => p.brandText !== null && (p.brandText ?? "").trim() === ""
  ).length;
  const expectedNull = toNull + whitespaceOnly;
  const orphans = await prisma.product.count({
    where: { brandId: null, brandText: { not: null } },
  });
  console.log(`\nApplied. Brands created/ensured: ${brandIdByName.size}`);
  console.log(
    `Products with brandText but null brandId (expected == ${expectedNull}` +
      `, of which ${whitespaceOnly} whitespace-only): ${orphans}`
  );
  if (orphans !== expectedNull) {
    console.warn("⚠ Orphan count does not match expected null count — investigate before dropping brandText.");
  } else {
    console.log("✓ Reconciliation clean. Safe to proceed to the drop-brandText migration.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Backfill error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
