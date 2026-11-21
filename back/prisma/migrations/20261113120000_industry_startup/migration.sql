-- Industrie : période de démarrage (aucun intérêt avant la mise en service).
ALTER TABLE "industry_plant" ADD COLUMN "readyAt" TIMESTAMP(3);
