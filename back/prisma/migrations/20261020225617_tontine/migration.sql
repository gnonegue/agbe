-- CreateEnum
CREATE TYPE "TontineStatus" AS ENUM ('FORMING', 'ACTIVE', 'FINISHED', 'CANCELLED');

-- AlterTable
ALTER TABLE "character" ADD COLUMN     "tontineDefaults" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tontine" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "ownerId" UUID NOT NULL,
    "contribution" BIGINT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "status" "TontineStatus" NOT NULL DEFAULT 'FORMING',
    "startDay" INTEGER,
    "nextPayout" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tontine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tontine_member" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "turn" INTEGER,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tontine_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tontine_contribution" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tontine_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tontine_payout" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "beneficiaryId" UUID,
    "amount" BIGINT NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tontine_payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tontine_status_createdAt_idx" ON "tontine"("status", "createdAt");

-- CreateIndex
CREATE INDEX "tontine_member_characterId_idx" ON "tontine_member"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "tontine_member_tontineId_characterId_key" ON "tontine_member"("tontineId", "characterId");

-- CreateIndex
CREATE INDEX "tontine_contribution_tontineId_round_idx" ON "tontine_contribution"("tontineId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "tontine_contribution_memberId_round_key" ON "tontine_contribution"("memberId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "tontine_payout_tontineId_round_key" ON "tontine_payout"("tontineId", "round");

-- AddForeignKey
ALTER TABLE "tontine_member" ADD CONSTRAINT "tontine_member_tontineId_fkey" FOREIGN KEY ("tontineId") REFERENCES "tontine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tontine_member" ADD CONSTRAINT "tontine_member_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tontine_contribution" ADD CONSTRAINT "tontine_contribution_tontineId_fkey" FOREIGN KEY ("tontineId") REFERENCES "tontine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tontine_contribution" ADD CONSTRAINT "tontine_contribution_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "tontine_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tontine_payout" ADD CONSTRAINT "tontine_payout_tontineId_fkey" FOREIGN KEY ("tontineId") REFERENCES "tontine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Portefeuille système de séquestre des tontines
INSERT INTO "wallet" ("id", "systemCode") VALUES (gen_random_uuid(), 'TONTINE') ON CONFLICT DO NOTHING;
ALTER TABLE "tontine" ADD CONSTRAINT "tontine_contribution_positive" CHECK ("contribution" > 0);
ALTER TABLE "tontine_contribution" ADD CONSTRAINT "tontine_contribution_amount_positive" CHECK ("amount" > 0);
