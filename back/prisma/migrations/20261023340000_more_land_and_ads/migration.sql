-- Lotissement agrandi (4 rangées de parcelles au lieu de 2, indices existants inchangés), zones publicitaires des lacs doublées,
-- et gare Sotral décalée pour laisser la place au lotissement. S'applique aux réglages déjà enregistrés en base.
UPDATE game_setting SET value = jsonb_set(value, '{rows}', '4'::jsonb) WHERE key = 'estate' AND (value->>'rows')::int < 4;
UPDATE game_setting SET value = (
  SELECT jsonb_agg(
    CASE z->>'id'
      WHEN 'lac_ouest' THEN jsonb_set(jsonb_set(z, '{cols}', '12'::jsonb), '{rows}', '6'::jsonb)
      WHEN 'lac_est' THEN jsonb_set(jsonb_set(z, '{cols}', '8'::jsonb), '{rows}', '4'::jsonb)
      ELSE z END)
  FROM jsonb_array_elements(value) AS z)
WHERE key = 'ad.zones';
UPDATE venue SET x = -104, z = -70 WHERE id = 'gare_sotral';
