-- Connexion avec Google : identifiant stable du compte Google lié au compte du jeu.
ALTER TABLE "account" ADD COLUMN "googleSub" VARCHAR(64);
CREATE UNIQUE INDEX "account_googleSub_key" ON "account"("googleSub");
