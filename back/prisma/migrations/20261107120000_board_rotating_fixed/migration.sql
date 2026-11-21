-- Panneau en libre-service : rotatif par défaut (3 500 FCFA / 7 jours, produit board_7d, affiche sur tous les panneaux sans annonce fixe),
-- ou fixe sur un panneau choisi, majoré de 50 % (5 250 FCFA, produit board_fixed_7d). Réservations déjà payées inchangées.
UPDATE "product" SET "priceAmount" = 3500, "nameFr" = 'Panneau publicitaire rotatif, 7 jours', "nameEn" = 'Rotating billboard, 7 days' WHERE "id" = 'board_7d';
INSERT INTO "product" ("id", "kind", "nameFr", "nameEn", "priceAmount", "currency", "coinsGranted", "active")
VALUES ('board_fixed_7d', 'AD_BOARD', 'Panneau publicitaire fixe, 7 jours', 'Fixed billboard, 7 days', 5250, 'XOF', 0, true)
ON CONFLICT ("id") DO NOTHING;
