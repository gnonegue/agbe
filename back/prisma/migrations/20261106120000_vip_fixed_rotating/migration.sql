-- Formules VIP : panneaux fixes (numéro précis) et rotatifs (« tous panneaux ») comptés séparément.
-- Bronze : 1 rotatif ; Argent : 2 fixes + 1 rotatif ; Or : 4 fixes + 2 rotatifs ; emplois et événements resserrés avec les nouveaux prix.
-- Sans ligne de réglage, les défauts du code s'appliquent déjà.
UPDATE "game_setting"
SET "value" = jsonb_set(jsonb_set(jsonb_set("value",
      '{BRONZE}', ("value"->'BRONZE') || '{"boards":0,"rotating":1,"jobs":0,"eventsPerMonth":0}'::jsonb),
      '{SILVER}', ("value"->'SILVER') || '{"boards":2,"rotating":1,"jobs":3,"eventsPerMonth":1}'::jsonb),
      '{GOLD}', ("value"->'GOLD') || '{"boards":4,"rotating":2,"jobs":10,"eventsPerMonth":2}'::jsonb)
WHERE "key" = 'partners.tiers' AND "value" ? 'BRONZE' AND "value" ? 'SILVER' AND "value" ? 'GOLD';
