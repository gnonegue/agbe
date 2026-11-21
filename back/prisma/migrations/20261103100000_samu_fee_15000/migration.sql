-- Frais du SAMU ramenés de 45 000 à 15 000 FCFA, si le réglage n'avait pas été modifié dans /admin.
UPDATE "game_setting" SET "value" = jsonb_set("value", '{fee}', '15000'::jsonb)
WHERE "key" = 'emergency.samu' AND ("value"->>'fee') = '45000';
