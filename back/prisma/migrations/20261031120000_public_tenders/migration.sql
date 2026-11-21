-- Marchés publics (tenders) : marchés ciblant un secteur d'entreprise, candidatures, sélection, paiement.
CREATE TYPE "TenderStatus" AS ENUM ('OPEN', 'AWARDED', 'CANCELLED');
CREATE TYPE "TenderApplicationStatus" AS ENUM ('PENDING', 'SELECTED', 'REJECTED');

CREATE TABLE "public_tender" (
    "id" UUID NOT NULL,
    "sector" VARCHAR(32) NOT NULL,
    "slots" INTEGER NOT NULL,
    "maxBudget" BIGINT NOT NULL,
    "maxHours" INTEGER NOT NULL,
    "status" "TenderStatus" NOT NULL DEFAULT 'OPEN',
    "applicationDeadlineAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" UUID,
    "idempotencyKey" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_tender_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_tender_idempotencyKey_key" ON "public_tender"("idempotencyKey");
CREATE INDEX "public_tender_status_applicationDeadlineAt_idx" ON "public_tender"("status", "applicationDeadlineAt");

CREATE TABLE "tender_application" (
    "id" UUID NOT NULL,
    "tenderId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "proposedPrice" BIGINT NOT NULL,
    "proposedHours" INTEGER NOT NULL,
    "status" "TenderApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_application_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tender_application_tenderId_companyId_key" ON "tender_application"("tenderId", "companyId");
CREATE INDEX "tender_application_status_endsAt_idx" ON "tender_application"("status", "endsAt");
CREATE INDEX "tender_application_companyId_idx" ON "tender_application"("companyId");

ALTER TABLE "tender_application" ADD CONSTRAINT "tender_application_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public_tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tender_application" ADD CONSTRAINT "tender_application_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
