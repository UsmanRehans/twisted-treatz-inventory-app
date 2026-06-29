-- Additive only: this runs against the live production database.
-- Brand becomes a first-class entity. The existing free-text Product."brand"
-- column is RENAMED to "brandText" (data preserved, NOT dropped) and a
-- nullable "brandId" FK is added. The one-shot scripts/backfill-brands.ts
-- then populates Brand rows and links brandId; a SEPARATE later migration
-- drops "brandText" — only after backfill verification passes. See
-- docs/BRAND_MIGRATION.md for the ordered runbook.

-- CreateTable
CREATE TABLE "Brand" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- Preserve existing free-text brand values: rename, do not drop.
ALTER TABLE "Product" RENAME COLUMN "brand" TO "brandText";

-- Add the nullable FK column (raw sugar etc. legitimately has no brand).
ALTER TABLE "Product" ADD COLUMN "brandId" INTEGER;

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- AddForeignKey: ON DELETE SET NULL — brand is recoverable metadata, not an
-- audit record, so nulling the link is safer than blocking a (manual) delete.
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
