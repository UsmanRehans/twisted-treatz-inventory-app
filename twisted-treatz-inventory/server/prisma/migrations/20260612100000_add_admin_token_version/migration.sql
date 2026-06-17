-- Additive only: this runs against the live production database.
-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
