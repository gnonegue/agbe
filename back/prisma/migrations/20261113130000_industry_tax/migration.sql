-- Industrie : impôt OTR sur le chiffre d'affaires, déclaré et payé à l'OTR.
ALTER TABLE "industry_plant" ADD COLUMN "taxDue" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "industry_plant" ADD COLUMN "taxSince" TIMESTAMP(3);
ALTER TABLE "industry_plant" ADD CONSTRAINT "industry_plant_tax_check" CHECK ("taxDue" >= 0);
