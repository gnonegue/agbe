-- Marchés publics : contenu réel (titre + description bilingues) au lieu du seul code de secteur.
-- Colonnes ajoutées nullable, puis complétées pour les lignes déjà en base (générées par le tick automatique
-- entre-temps) avec un texte générique de repli basé sur `sector`, puis verrouillées en NOT NULL.
ALTER TABLE "public_tender" ADD COLUMN "titleFr" VARCHAR(160);
ALTER TABLE "public_tender" ADD COLUMN "titleEn" VARCHAR(160);
ALTER TABLE "public_tender" ADD COLUMN "descriptionFr" VARCHAR(600);
ALTER TABLE "public_tender" ADD COLUMN "descriptionEn" VARCHAR(600);

UPDATE "public_tender" SET
  "titleFr" = 'Marché public — ' || "sector",
  "titleEn" = 'Public tender — ' || "sector",
  "descriptionFr" = 'Marché public généré pour le secteur ' || "sector" || '.',
  "descriptionEn" = 'Public tender generated for the ' || "sector" || ' sector.'
WHERE "titleFr" IS NULL;

ALTER TABLE "public_tender" ALTER COLUMN "titleFr" SET NOT NULL;
ALTER TABLE "public_tender" ALTER COLUMN "titleEn" SET NOT NULL;
ALTER TABLE "public_tender" ALTER COLUMN "descriptionFr" SET NOT NULL;
ALTER TABLE "public_tender" ALTER COLUMN "descriptionEn" SET NOT NULL;
