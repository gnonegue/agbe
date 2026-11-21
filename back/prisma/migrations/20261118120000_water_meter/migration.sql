-- Eau au compteur : litres utilisés pour la cuisine depuis la dernière facture.
ALTER TABLE "character" ADD COLUMN "waterLitresUsed" INTEGER NOT NULL DEFAULT 0;
