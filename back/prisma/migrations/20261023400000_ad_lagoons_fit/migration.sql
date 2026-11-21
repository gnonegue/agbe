-- Zones publicitaires des lagunes : retour à la taille qui tient dans le plan d'eau, et la lagune de l'aéroport (déplacée de 9 unités vers le sud
-- côté client) ne touche plus la route d'accès de l'aérogare.
UPDATE game_setting SET value = (
  SELECT jsonb_agg(
    CASE z->>'id'
      WHEN 'lac_ouest' THEN jsonb_set(jsonb_set(z, '{cols}', '6'::jsonb), '{rows}', '3'::jsonb)
      WHEN 'lac_est' THEN jsonb_set(jsonb_set(jsonb_set(z, '{cols}', '4'::jsonb), '{rows}', '2'::jsonb), '{originZ}', '-94'::jsonb)
      ELSE z END)
  FROM jsonb_array_elements(value) AS z)
WHERE key = 'ad.zones';
