-- Signalements de bugs envoyés depuis le jeu : même boîte que les messages du site, avec leur contexte.
ALTER TABLE "contact_message" ADD COLUMN "context" VARCHAR(400);
