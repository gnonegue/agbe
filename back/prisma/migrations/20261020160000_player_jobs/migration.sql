-- Emploi entre joueurs : salarié joueur et offres d'emploi
ALTER TABLE "employee" ADD COLUMN "characterId" UUID;
CREATE INDEX "employee_characterId_idx" ON "employee"("characterId");
ALTER TABLE "employee" ADD CONSTRAINT "employee_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "job_offer" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "roleFr" VARCHAR(48) NOT NULL,
    "roleEn" VARCHAR(48) NOT NULL,
    "grossMonthly" INTEGER NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_offer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_offer_gross_positive" CHECK ("grossMonthly" > 0)
);
CREATE INDEX "job_offer_open_createdAt_idx" ON "job_offer"("open", "createdAt");
CREATE INDEX "job_offer_companyId_idx" ON "job_offer"("companyId");
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
