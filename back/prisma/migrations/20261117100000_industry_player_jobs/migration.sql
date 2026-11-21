-- Industrie : des joueurs salariés dans les sites (offres d'emploi, salariés rattachés à un site).
ALTER TABLE "employee" ADD COLUMN "plantId" UUID;
CREATE INDEX "employee_plantId_idx" ON "employee"("plantId");
ALTER TABLE "employee" ADD CONSTRAINT "employee_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "industry_plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "plant_job_offer" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "roleId" VARCHAR(32) NOT NULL,
    "roleFr" VARCHAR(48) NOT NULL,
    "roleEn" VARCHAR(48) NOT NULL,
    "grossMonthly" INTEGER NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plant_job_offer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plant_job_offer_gross_check" CHECK ("grossMonthly" > 0)
);
CREATE INDEX "plant_job_offer_open_createdAt_idx" ON "plant_job_offer"("open", "createdAt");
CREATE INDEX "plant_job_offer_plantId_idx" ON "plant_job_offer"("plantId");
ALTER TABLE "plant_job_offer" ADD CONSTRAINT "plant_job_offer_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "industry_plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un salarié travaille pour une entreprise de joueur, un employeur public ou un site industriel.
ALTER TABLE "employee" DROP CONSTRAINT "employee_employer_check";
ALTER TABLE "employee" ADD CONSTRAINT "employee_employer_check" CHECK ("companyId" IS NOT NULL OR "publicJobId" IS NOT NULL OR "plantId" IS NOT NULL);
