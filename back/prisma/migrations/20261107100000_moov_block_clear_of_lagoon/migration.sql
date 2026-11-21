-- Îlot Moov / gare Sotral / lagune est : les trois lieux se chevauchaient et l'eau entrait dans le siège de Moov.
-- Siège de Moov 2 m au nord, gare Sotral réduite, 2 m au nord et 8 m à l'est, dégagée de la route, marché d'Akodessewa sorti de l'immeuble et posé sur la grande pelouse derrière l'aéroport, lagune et cases publicitaires 13 m vers l'est.
UPDATE "venue" SET "z" = -80 WHERE "id" = 'moov_africa';
UPDATE "venue" SET "x" = 108, "z" = -92 WHERE "id" = 'gare_sotral';
UPDATE "venue" SET "x" = 201, "z" = -96 WHERE "id" = 'akodessewa';
UPDATE game_setting SET value = (
  SELECT jsonb_agg(
    CASE z->>'id'
      WHEN 'lac_est' THEN jsonb_set(z, '{originX}', '125'::jsonb)
      ELSE z END)
  FROM jsonb_array_elements(value) AS z)
WHERE key = 'ad.zones';
