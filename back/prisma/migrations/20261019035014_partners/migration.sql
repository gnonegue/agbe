-- CreateEnum
CREATE TYPE "PartnerKind" AS ENUM ('BRAND', 'SCHOOL', 'ARTIST', 'PROMOTER', 'INSTITUTION');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ENDED');

-- CreateTable
CREATE TABLE "partner" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "kind" "PartnerKind" NOT NULL,
    "website" VARCHAR(200),
    "contact" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "title" VARCHAR(40) NOT NULL,
    "subtitle" VARCHAR(80) NOT NULL,
    "bg" VARCHAR(7) NOT NULL,
    "fg" VARCHAR(7) NOT NULL,
    "url" VARCHAR(200),
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PENDING',
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_status_endsAt_idx" ON "campaign"("status", "endsAt");

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
