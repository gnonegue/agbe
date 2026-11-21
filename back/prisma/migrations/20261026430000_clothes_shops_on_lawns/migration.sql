-- Boutiques de mode déplacées sur des pelouses libres : Nyékonakpoè était dans le Lac Ouest,
-- Bè au bord du Lac Est et Adidogomé sur le lotissement à vendre.
UPDATE "venue" SET "x" = -77, "z" = -15 WHERE "id" = 'mode_nyekonakpoe';
UPDATE "venue" SET "x" = 146, "z" = -43 WHERE "id" = 'mode_be';
UPDATE "venue" SET "x" = -152, "z" = -84 WHERE "id" = 'mode_adidogome';
