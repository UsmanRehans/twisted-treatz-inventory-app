-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "resetTokenExpires" TIMESTAMP(3),
ADD COLUMN     "resetTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Admin_resetTokenHash_key" ON "Admin"("resetTokenHash");

