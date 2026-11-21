-- CreateEnum
CREATE TYPE "DepositKind" AS ENUM ('SAVINGS', 'TERM');

-- CreateTable
CREATE TABLE "bank_deposit" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "bankId" VARCHAR(16) NOT NULL,
    "kind" "DepositKind" NOT NULL,
    "principal" BIGINT NOT NULL DEFAULT 0,
    "yearBp" INTEGER NOT NULL,
    "startDay" INTEGER NOT NULL,
    "termDays" INTEGER,
    "lastAccruedDay" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_deposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_deposit_characterId_closedAt_idx" ON "bank_deposit"("characterId", "closedAt");


-- Un seul livret ouvert par banque et par personnage ; capital jamais négatif
CREATE UNIQUE INDEX "bank_deposit_one_savings" ON "bank_deposit" ("characterId", "bankId") WHERE "kind" = 'SAVINGS' AND "closedAt" IS NULL;
ALTER TABLE "bank_deposit" ADD CONSTRAINT "bank_deposit_principal_nonneg" CHECK ("principal" >= 0);
