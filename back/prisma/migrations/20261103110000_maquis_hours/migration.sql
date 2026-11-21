-- Le maquis de Bè ouvre de 11 h à 5 h (il était réglé de 11 h à 2 h), si l'horaire n'avait pas été modifié dans /admin.
UPDATE "game_setting" SET "value" = jsonb_set("value", '{maquis_be}', '[11, 5]'::jsonb)
WHERE "key" = 'venues.hours' AND ("value"->'maquis_be') = '[11, 2]'::jsonb;
