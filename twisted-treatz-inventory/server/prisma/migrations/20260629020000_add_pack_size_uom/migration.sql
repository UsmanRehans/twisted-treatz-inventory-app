-- Add structured pack-size + unit-of-measure columns to Product.
-- Mirrors Hani's master inventory sheet, which keeps "Pack Size" (numeric,
-- e.g. 30, 20, 26.4) and "UOM" (e.g. "lb", "ct") as two separate columns
-- instead of the single free-text unitSize blob. Both nullable: existing
-- rows keep their unitSize string until backfilled/edited.
ALTER TABLE "Product"
  ADD COLUMN "packSize" DECIMAL(10,3),
  ADD COLUMN "uom" TEXT;
