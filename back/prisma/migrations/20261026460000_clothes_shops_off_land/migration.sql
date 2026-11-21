-- Boutiques sorties des zones de terrains à vendre : Nyékonakpoè débordait sur « Ville – Nord-Ouest »,
-- Bè sur « Ville – Marché ».
UPDATE "venue" SET "x" = -159, "z" = -42 WHERE "id" = 'mode_nyekonakpoe';
UPDATE "venue" SET "x" = 182, "z" = -18 WHERE "id" = 'mode_be';
