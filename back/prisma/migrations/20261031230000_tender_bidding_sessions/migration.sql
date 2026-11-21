-- Marchés publics : retour à la candidature par enchère (prix + délai proposés par le candidat), avec un
-- coût de réalisation (requiredSessions × coût du secteur) connu de tous AVANT de candidater, et une vraie
-- séance de travail répétée (sessionsCompleted) qui déclenche le paiement à la fin, plutôt qu'un paiement
-- automatique à une échéance de temps passive.

-- "maxBudget" devient un PLAFOND annoncé (pas un montant fixe payé) : le commentaire du modèle reflète ce
-- changement de sens, la colonne elle-même ne change pas de type.

ALTER TYPE "TenderApplicationStatus" ADD VALUE 'PAID';

-- Nombre de séances de travail nécessaires pour réaliser le projet : ajoutée nullable, puis complétée pour les
-- lignes déjà en base avec une valeur par défaut raisonnable (3 séances), puis verrouillée en NOT NULL.
ALTER TABLE "public_tender" ADD COLUMN "requiredSessions" INTEGER;
UPDATE "public_tender" SET "requiredSessions" = 3 WHERE "requiredSessions" IS NULL;
ALTER TABLE "public_tender" ALTER COLUMN "requiredSessions" SET NOT NULL;

-- Remet "proposedPrice" (supprimée par la migration "tender_fixed_price") : ajoutée nullable, complétée pour
-- les lignes déjà en base avec le budget plafond du marché (meilleure estimation disponible rétroactivement,
-- ces candidatures n'ayant jamais proposé de prix), puis verrouillée en NOT NULL.
ALTER TABLE "tender_application" ADD COLUMN "proposedPrice" BIGINT;
UPDATE "tender_application" ta SET "proposedPrice" = pt."maxBudget"
  FROM "public_tender" pt WHERE pt."id" = ta."tenderId" AND ta."proposedPrice" IS NULL;
ALTER TABLE "tender_application" ALTER COLUMN "proposedPrice" SET NOT NULL;

-- Progression RÉELLE du travail (séances de travail accomplies) et horodatage du dernier appel à advance()
-- pour imposer la cadence entre deux séances.
ALTER TABLE "tender_application" ADD COLUMN "sessionsCompleted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tender_application" ADD COLUMN "lastAdvancedAt" TIMESTAMP(3);
