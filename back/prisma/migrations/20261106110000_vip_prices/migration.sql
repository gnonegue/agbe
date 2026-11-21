-- Tarifs mensuels des espaces VIP : Bronze 10 000, Argent 20 000, Or 35 000 FCFA (décision du 6 novembre 2026).
-- Sans ligne de réglage, les défauts du code s'appliquent déjà.
UPDATE "game_setting"
SET "value" = jsonb_set(
      jsonb_set(
        jsonb_set("value", '{BRONZE,monthlyPrice}', '10000'::jsonb),
        '{SILVER,monthlyPrice}', '20000'::jsonb),
      '{GOLD,monthlyPrice}', '35000'::jsonb)
WHERE "key" = 'partners.tiers' AND "value" ? 'BRONZE' AND "value" ? 'SILVER' AND "value" ? 'GOLD';
