-- Industrie : un site appartient à une entreprise immatriculée de son propriétaire.
ALTER TABLE "industry_plant" ADD COLUMN "companyId" UUID;
CREATE INDEX "industry_plant_companyId_idx" ON "industry_plant"("companyId");
ALTER TABLE "industry_plant" ADD CONSTRAINT "industry_plant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
