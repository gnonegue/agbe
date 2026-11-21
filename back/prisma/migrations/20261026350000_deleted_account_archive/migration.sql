-- Comptes supprimés : identité gardée pour l'administration (fraude, litiges), effacée automatiquement après la durée de conservation.
-- CreateTable
CREATE TABLE "deleted_account" (
    "accountId" UUID NOT NULL,
    "username" VARCHAR(32),
    "email" TEXT,
    "phone" TEXT,
    "googleSub" VARCHAR(64),
    "birthDate" DATE NOT NULL,
    "characterName" VARCHAR(64),
    "ips" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAt" TIMESTAMP(3) NOT NULL,
    "hold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "deleted_account_pkey" PRIMARY KEY ("accountId")
);

-- CreateIndex
CREATE INDEX "deleted_account_purgeAt_idx" ON "deleted_account"("purgeAt");

-- CreateIndex
CREATE INDEX "deleted_account_email_idx" ON "deleted_account"("email");

-- CreateIndex
CREATE INDEX "deleted_account_phone_idx" ON "deleted_account"("phone");

