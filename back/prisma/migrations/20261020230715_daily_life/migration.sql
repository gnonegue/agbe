-- CreateEnum
CREATE TYPE "FamilyRequestStatus" AS ENUM ('PENDING', 'PAID', 'REFUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CeremonyKind" AS ENUM ('DOT', 'BAPTEME', 'FUNERAILLES', 'ANNIVERSAIRE');

-- AlterTable
ALTER TABLE "character" ADD COLUMN     "diagnosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "generator" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "illnessDay" INTEGER,
ADD COLUMN     "illnessId" VARCHAR(32),
ADD COLUMN     "lifeCheckedDay" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "powerCutUntil" TIMESTAMP(3),
ADD COLUMN     "solar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waterCutUntil" TIMESTAMP(3),
ADD COLUMN     "waterTank" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "family_request" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "amount" BIGINT NOT NULL,
    "day" INTEGER NOT NULL,
    "expiresDay" INTEGER NOT NULL,
    "status" "FamilyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceremony" (
    "id" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "kind" "CeremonyKind" NOT NULL,
    "venueId" VARCHAR(32) NOT NULL,
    "day" INTEGER NOT NULL,
    "cost" BIGINT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ceremony_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceremony_guest" (
    "id" UUID NOT NULL,
    "ceremonyId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "gift" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ceremony_guest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_request_characterId_status_idx" ON "family_request"("characterId", "status");

-- CreateIndex
CREATE INDEX "ceremony_day_cancelled_idx" ON "ceremony"("day", "cancelled");

-- CreateIndex
CREATE UNIQUE INDEX "ceremony_guest_ceremonyId_characterId_key" ON "ceremony_guest"("ceremonyId", "characterId");

-- AddForeignKey
ALTER TABLE "family_request" ADD CONSTRAINT "family_request_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceremony" ADD CONSTRAINT "ceremony_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceremony_guest" ADD CONSTRAINT "ceremony_guest_ceremonyId_fkey" FOREIGN KEY ("ceremonyId") REFERENCES "ceremony"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceremony_guest" ADD CONSTRAINT "ceremony_guest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "family_request" ADD CONSTRAINT "family_request_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ceremony" ADD CONSTRAINT "ceremony_cost_nonneg" CHECK ("cost" >= 0);
ALTER TABLE "ceremony_guest" ADD CONSTRAINT "ceremony_gift_nonneg" CHECK ("gift" >= 0);
