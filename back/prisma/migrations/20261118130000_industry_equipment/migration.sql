-- Industrie : équipements d'un site, forage et installation solaire.
ALTER TABLE "industry_plant" ADD COLUMN "borehole" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "industry_plant" ADD COLUMN "solar" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "industry_plant" ADD COLUMN "boreholeServicedAt" TIMESTAMP(3);
ALTER TABLE "industry_plant" ADD COLUMN "solarServicedAt" TIMESTAMP(3);
