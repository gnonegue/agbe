-- Demandes d'emplacement VIP (espaces verts Argent et Or), validées par l'administration.
CREATE TYPE "SpotRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "spot_request" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "spotId" VARCHAR(32) NOT NULL,
    "x" INTEGER NOT NULL,
    "z" INTEGER NOT NULL,
    "tier" "PartnerTier" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "company" VARCHAR(80),
    "whatsapp" VARCHAR(16) NOT NULL,
    "email" VARCHAR(120),
    "message" VARCHAR(1000) NOT NULL,
    "status" "SpotRequestStatus" NOT NULL DEFAULT 'PENDING',
    "partnerId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spot_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "spot_request_spotId_status_idx" ON "spot_request"("spotId", "status");
CREATE INDEX "spot_request_status_createdAt_idx" ON "spot_request"("status", "createdAt");

-- Un emplacement ne peut être approuvé qu'une fois (garantie en base, même en cas de deux validations simultanées)
CREATE UNIQUE INDEX "spot_request_one_approved_per_spot" ON "spot_request"("x", "z") WHERE "status" = 'APPROVED';
-- Un joueur ne dépose qu'une demande en attente par emplacement
CREATE UNIQUE INDEX "spot_request_one_pending_per_account_spot" ON "spot_request"("accountId", "spotId") WHERE "status" = 'PENDING';
