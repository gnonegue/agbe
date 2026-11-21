-- Électricité au compteur : kWh des cuissons au réchaud électrique depuis la dernière facture.
ALTER TABLE "character" ADD COLUMN "elecKwhUsed" INTEGER NOT NULL DEFAULT 0;
