-- Plusieurs entreprises par joueur, vente / fermeture, ventes automatiques des salariés
DROP INDEX IF EXISTS "company_characterId_key";
CREATE INDEX "company_characterId_idx" ON "company"("characterId");
ALTER TABLE "company" ADD COLUMN "closedAt" TIMESTAMP(3), ADD COLUMN "lastAutoSaleAt" TIMESTAMP(3);
ALTER TABLE "character" ADD COLUMN "activeCompanyId" UUID;
