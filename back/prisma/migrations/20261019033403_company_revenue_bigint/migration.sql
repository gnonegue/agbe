/*
  Warnings:

  - You are about to drop the column `revenue` on the `company` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "company" DROP COLUMN "revenue",
ADD COLUMN     "pendingRevenue" BIGINT NOT NULL DEFAULT 0;
