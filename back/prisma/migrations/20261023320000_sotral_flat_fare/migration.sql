-- Sotral : tarif unique de 150 FCFA quelle que soit la distance (réglage enregistré en base, s'il existe).
UPDATE game_setting SET value = jsonb_set(jsonb_set(value, '{BUS,base}', '150'::jsonb), '{BUS,perKm}', '0'::jsonb) WHERE key = 'transport.modes' AND value ? 'BUS';
