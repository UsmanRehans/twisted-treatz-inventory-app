-- Product variations: a parent ProductGroup ("Jelly Beans") above Product,
-- with Product.variant naming the flavor/size. Purely additive — no existing
-- column or row changes, so stock, thresholds and history are untouched.
CREATE TABLE "ProductGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "variantLabel" TEXT NOT NULL DEFAULT 'Flavor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductGroup_name_key" ON "ProductGroup"("name");

ALTER TABLE "Product"
  ADD COLUMN "groupId" INTEGER,
  ADD COLUMN "variant" TEXT;

CREATE INDEX "Product_groupId_idx" ON "Product"("groupId");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_groupId_fkey" FOREIGN KEY ("groupId")
  REFERENCES "ProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
