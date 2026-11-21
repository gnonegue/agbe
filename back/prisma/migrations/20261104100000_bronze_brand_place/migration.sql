-- La formule Bronze obtient, comme Argent et Or, un emplacement de marque (espaces VIP Bronze), si le réglage n'avait pas été modifié dans /admin.
UPDATE "game_setting" SET "value" = jsonb_set("value", '{BRONZE,brandPlace}', 'true'::jsonb)
WHERE "key" = 'partners.tiers' AND ("value"->'BRONZE'->'brandPlace') = 'false'::jsonb;
