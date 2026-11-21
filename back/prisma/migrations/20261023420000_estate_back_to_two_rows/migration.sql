-- Lotissement : retour à 2 rangées. Avec 4 rangées, il recouvrait la route est-ouest z = -110 et l'avenue x = -90 ; la gare Sotral reprend sa place.
UPDATE game_setting SET value = jsonb_set(value, '{rows}', '2'::jsonb) WHERE key = 'estate' AND (value->>'rows')::int > 2;
UPDATE venue SET x = -96, z = -96 WHERE id = 'gare_sotral';
