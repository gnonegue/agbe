-- Dossier de consultation : examen, demandes d'analyses, résultats, interprétation et ordonnance.
CREATE TABLE "medical_visit" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "illnessId" VARCHAR(32),
    "status" VARCHAR(12) NOT NULL,
    "orders" JSONB NOT NULL,
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_visit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medical_visit_characterId_createdAt_idx" ON "medical_visit"("characterId", "createdAt");

ALTER TABLE "medical_visit" ADD CONSTRAINT "medical_visit_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
