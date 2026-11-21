-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PLAYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('LOCAL', 'DIASPORA', 'FOREIGNER');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('MARITIME', 'PLATEAUX', 'CENTRALE', 'KARA', 'SAVANES');

-- CreateEnum
CREATE TYPE "BirthCondition" AS ENUM ('RICH', 'MIDDLE', 'POOR');

-- CreateEnum
CREATE TYPE "BirthMode" AS ENUM ('FREE_CHOICE', 'DESTINY');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('COINS', 'PREMIUM');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'fr',
    "role" "Role" NOT NULL DEFAULT 'PLAYER',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "mfa" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "userAgent" VARCHAR(256),
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "version" VARCHAR(16) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "profile" "ProfileType" NOT NULL,
    "region" "Region" NOT NULL,
    "birthCondition" "BirthCondition" NOT NULL,
    "birthMode" "BirthMode" NOT NULL,
    "housing" VARCHAR(32) NOT NULL,
    "hunger" INTEGER NOT NULL DEFAULT 80,
    "energy" INTEGER NOT NULL DEFAULT 80,
    "hygiene" INTEGER NOT NULL DEFAULT 80,
    "health" INTEGER NOT NULL DEFAULT 90,
    "morale" INTEGER NOT NULL DEFAULT 70,
    "respect" INTEGER NOT NULL DEFAULT 10,
    "needsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" VARCHAR(32),
    "lastWorkedAt" TIMESTAMP(3),
    "lastRestAt" TIMESTAMP(3),
    "rentPaidUntilGameDay" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet" (
    "id" UUID NOT NULL,
    "characterId" UUID,
    "systemCode" VARCHAR(32),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'XOF',
    "balance" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transaction" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "idempotencyKey" VARCHAR(128),
    "memo" VARCHAR(140),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_setting" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "game_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "job" (
    "id" VARCHAR(32) NOT NULL,
    "level" VARCHAR(16) NOT NULL,
    "nameFr" VARCHAR(64) NOT NULL,
    "nameEn" VARCHAR(64) NOT NULL,
    "payPerShift" INTEGER NOT NULL,
    "energyCost" INTEGER NOT NULL,
    "hungerCost" INTEGER NOT NULL,
    "hygieneCost" INTEGER NOT NULL DEFAULT 0,
    "shiftGameHours" INTEGER NOT NULL,
    "riskPercent" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_item" (
    "id" VARCHAR(32) NOT NULL,
    "nameFr" VARCHAR(64) NOT NULL,
    "nameEn" VARCHAR(64) NOT NULL,
    "price" INTEGER NOT NULL,
    "hunger" INTEGER NOT NULL,
    "energy" INTEGER NOT NULL DEFAULT 0,
    "morale" INTEGER NOT NULL DEFAULT 0,
    "health" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "food_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" VARCHAR(32) NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "nameFr" VARCHAR(64) NOT NULL,
    "nameEn" VARCHAR(64) NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'XOF',
    "coinsGranted" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "productId" VARCHAR(32) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "providerRef" VARCHAR(128),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_event" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "eventId" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "target" VARCHAR(128),
    "meta" JSONB,
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_email_key" ON "account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "account_phone_key" ON "account"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "session_tokenHash_key" ON "session"("tokenHash");

-- CreateIndex
CREATE INDEX "session_accountId_idx" ON "session"("accountId");

-- CreateIndex
CREATE INDEX "session_familyId_idx" ON "session"("familyId");

-- CreateIndex
CREATE INDEX "consent_accountId_idx" ON "consent"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "character_accountId_key" ON "character"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_characterId_key" ON "wallet"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_systemCode_key" ON "wallet"("systemCode");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transaction_idempotencyKey_key" ON "ledger_transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_transaction_createdAt_idx" ON "ledger_transaction"("createdAt");

-- CreateIndex
CREATE INDEX "ledger_entry_walletId_createdAt_idx" ON "ledger_entry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entry_transactionId_idx" ON "ledger_entry"("transactionId");

-- CreateIndex
CREATE INDEX "purchase_accountId_idx" ON "purchase"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_provider_providerRef_key" ON "purchase"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "payment_event_provider_eventId_key" ON "payment_event"("provider", "eventId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_actorId_idx" ON "audit_log"("actorId");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Garde-fous au niveau de la base (défense en profondeur) ─────────────

-- Un portefeuille appartient soit à un personnage, soit au système, jamais aux deux ni à aucun.
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_owner_xor"
  CHECK (("characterId" IS NULL) <> ("systemCode" IS NULL));

-- Le solde d'un joueur ne peut jamais devenir négatif, même en cas de bug applicatif.
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_player_nonneg"
  CHECK ("systemCode" IS NOT NULL OR "balance" >= 0);

-- Une ligne de grand livre ne vaut jamais zéro.
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_nonzero" CHECK ("amount" <> 0);

-- Besoins bornés 0..100.
ALTER TABLE "character" ADD CONSTRAINT "character_needs_range" CHECK (
  "hunger" BETWEEN 0 AND 100 AND "energy" BETWEEN 0 AND 100 AND "hygiene" BETWEEN 0 AND 100 AND
  "health" BETWEEN 0 AND 100 AND "morale" BETWEEN 0 AND 100 AND "respect" BETWEEN 0 AND 100
);

-- Prix et montants positifs.
ALTER TABLE "product" ADD CONSTRAINT "product_price_pos" CHECK ("priceAmount" > 0 AND "coinsGranted" >= 0);
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "food_item" ADD CONSTRAINT "food_price_pos" CHECK ("price" > 0);
ALTER TABLE "job" ADD CONSTRAINT "job_values_pos" CHECK ("payPerShift" > 0 AND "shiftGameHours" > 0 AND "riskPercent" BETWEEN 0 AND 100);

-- Le grand livre est en ajout seul : interdiction de modifier ou supprimer une écriture.
CREATE OR REPLACE FUNCTION agbe_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entry_no_update" BEFORE UPDATE OR DELETE ON "ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION agbe_ledger_append_only();
CREATE TRIGGER "ledger_transaction_no_update" BEFORE UPDATE OR DELETE ON "ledger_transaction"
  FOR EACH ROW EXECUTE FUNCTION agbe_ledger_append_only();

-- Chaque transaction de grand livre doit être équilibrée (somme des lignes = 0), vérifié à la fin de la transaction SQL.
CREATE OR REPLACE FUNCTION agbe_ledger_balanced() RETURNS trigger AS $$
DECLARE s NUMERIC;
BEGIN
  SELECT COALESCE(SUM("amount"), 0) INTO s FROM "ledger_entry" WHERE "transactionId" = NEW."transactionId";
  IF s <> 0 THEN
    RAISE EXCEPTION 'unbalanced ledger transaction %', NEW."transactionId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_entry_balanced" AFTER INSERT ON "ledger_entry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION agbe_ledger_balanced();
