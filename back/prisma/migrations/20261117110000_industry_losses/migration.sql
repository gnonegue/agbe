-- Industrie : un site peut perdre de l'argent (mauvais jours, incidents, charges fixes) : le résultat en attente peut être négatif.
ALTER TABLE "industry_plant" DROP CONSTRAINT "industry_plant_paid_check";
ALTER TABLE "industry_plant" ADD CONSTRAINT "industry_plant_paid_check" CHECK ("paid" >= 0);
