-- AlterEnum
ALTER TYPE "CampaignStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterEnum
ALTER TYPE "ProductKind" ADD VALUE 'AD_BOARD';

-- AlterTable
ALTER TABLE "campaign" ADD COLUMN     "days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "purchaseId" UUID;

-- AlterTable
ALTER TABLE "partner" ADD COLUMN     "accountId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "campaign_purchaseId_key" ON "campaign"("purchaseId");

-- CreateIndex
CREATE INDEX "partner_accountId_idx" ON "partner"("accountId");

ALTER TABLE "campaign" ADD CONSTRAINT "campaign_days_range" CHECK ("days" BETWEEN 1 AND 365);
