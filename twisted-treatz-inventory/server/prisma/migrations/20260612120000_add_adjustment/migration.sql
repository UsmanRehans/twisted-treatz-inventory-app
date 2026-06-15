-- Additive only: this runs against the live production database.
-- CreateTable
CREATE TABLE "Adjustment" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "adminId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "qtyBefore" INTEGER NOT NULL,
    "qtyAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Adjustment_batchId_idx" ON "Adjustment"("batchId");

-- CreateIndex
CREATE INDEX "Adjustment_createdAt_idx" ON "Adjustment"("createdAt");

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
