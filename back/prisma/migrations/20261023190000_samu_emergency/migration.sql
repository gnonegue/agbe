-- Urgence SAMU : prise en charge à l'hôpital (le personnage est indisponible) puis facture de soins à régler.
ALTER TABLE "character" ADD COLUMN "hospitalUntil" TIMESTAMP(3), ADD COLUMN "hospitalStartedAt" TIMESTAMP(3);

CREATE TABLE "medical_bill" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "fullAmount" INTEGER NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "medical_bill_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medical_bill_characterId_paidAt_idx" ON "medical_bill"("characterId", "paidAt");

ALTER TABLE "medical_bill" ADD CONSTRAINT "medical_bill_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
