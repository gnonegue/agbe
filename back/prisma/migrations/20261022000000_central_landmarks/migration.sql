-- Recaler les trois monuments dans l'îlot réservé au centre-ville.
-- Le seed seul ne met pas à jour les bases déjà utilisées par le jeu.
UPDATE "venue" SET "x" = 61, "z" = -56 WHERE "id" = 'palais_congres';
UPDATE "venue" SET "x" = 53, "z" = -38.5 WHERE "id" = 'marche_assigame';
UPDATE "venue" SET "x" = 80, "z" = -40 WHERE "id" = 'cathedrale';
