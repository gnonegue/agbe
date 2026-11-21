-- Les emplois ne font plus partie des formules VIP : ils sont créés par les joueurs (leur entreprise) ou par l'équipe.
UPDATE "game_setting"
SET "value" = jsonb_set(jsonb_set(jsonb_set("value", '{BRONZE,jobs}', '0'::jsonb), '{SILVER,jobs}', '0'::jsonb), '{GOLD,jobs}', '0'::jsonb)
WHERE "key" = 'partners.tiers' AND "value" ? 'BRONZE' AND "value" ? 'SILVER' AND "value" ? 'GOLD';
-- Les anciennes offres d'emploi de partenaires ne sont plus affichées.
UPDATE "partner_offer" SET "active" = false WHERE "kind" = 'JOB';
