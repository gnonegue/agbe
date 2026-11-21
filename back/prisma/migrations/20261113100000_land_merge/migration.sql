-- Regroupement de lots : une parcelle peut réunir plusieurs lots voisins (jusqu'à 8 lots = 32 quarts).
ALTER TABLE "land_holding" DROP CONSTRAINT "land_holding_quarters_check";
ALTER TABLE "land_holding" ADD CONSTRAINT "land_holding_quarters_check" CHECK ("quarters" BETWEEN 1 AND 32);
