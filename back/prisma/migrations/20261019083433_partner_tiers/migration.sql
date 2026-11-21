-- CreateEnum
CREATE TYPE "PartnerTier" AS ENUM ('NONE', 'BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('JOB', 'EVENT');

-- AlterTable
ALTER TABLE "partner" ADD COLUMN     "placeColor" VARCHAR(7),
ADD COLUMN     "placeLabel" VARCHAR(40),
ADD COLUMN     "placeX" INTEGER,
ADD COLUMN     "placeZ" INTEGER,
ADD COLUMN     "tier" "PartnerTier" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "tierEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "partner_offer" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(400) NOT NULL,
    "place" VARCHAR(80) NOT NULL,
    "url" VARCHAR(200),
    "happensAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_offer_kind_active_endsAt_idx" ON "partner_offer"("kind", "active", "endsAt");

-- AddForeignKey
ALTER TABLE "partner_offer" ADD CONSTRAINT "partner_offer_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

