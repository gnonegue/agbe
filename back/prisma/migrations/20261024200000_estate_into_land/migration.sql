-- Le lotissement d'Adidogomé devient une zone du foncier (« lotissement », prix du m² fixe) : les terrains et maisons déjà
-- achetés sont repris tels quels (titre foncier délivré, maison et emménagement conservés). La table estate_plot n'est plus utilisée.
WITH src AS (
  SELECT p."index", p."characterId", p.model, p."buildReadyAt", p."movedIn", p."boughtAt",
         row_number() OVER (ORDER BY p."index") AS n,
         COALESCE((SELECT (value->>'landPrice')::bigint FROM game_setting WHERE key = 'estate'), 800000) AS land_price
  FROM estate_plot p
  WHERE EXISTS (SELECT 1 FROM "character" c WHERE c.id = p."characterId")
),
ins AS (
  INSERT INTO land_holding (id, "characterId", "zoneId", cell, quarters, paid, status, "titleNo", "useId", "useCost", "useReadyAt", "useCollected", "movedIn", "createdAt")
  SELECT gen_random_uuid(), s."characterId", 'lotissement', s."index", 4, s.land_price, 'TITLED',
         'TF-' || lpad((90000000 + s.n)::text, 8, '0'),
         CASE s.model WHEN 'ENTRER_COUCHER' THEN 'house_small' WHEN 'CHAMBRE_SALON' THEN 'house_medium' WHEN 'VILLA' THEN 'house_villa' END,
         CASE WHEN s.model IS NULL THEN 0 ELSE COALESCE(
           (SELECT (value->'models'->s.model->>'cost')::bigint FROM game_setting WHERE key = 'estate'),
           CASE s.model WHEN 'ENTRER_COUCHER' THEN 1500000 WHEN 'CHAMBRE_SALON' THEN 4000000 ELSE 20000000 END) END,
         CASE WHEN s.model IS NULL THEN NULL ELSE s."buildReadyAt" END,
         0, s."movedIn", s."boughtAt"
  FROM src s
  RETURNING id, cell
)
INSERT INTO land_quarter ("zoneId", cell, q, "holdingId")
SELECT 'lotissement', ins.cell, g, ins.id FROM ins CROSS JOIN generate_series(0, 3) AS g;

-- Le bureau de l'entreprise de BTP garde sa place sur la carte ; il renvoie maintenant vers l'application Immobilier.
UPDATE venue SET
  "descFr" = 'Entreprise de construction : achète un terrain (lotissement d’Adidogomé ou ailleurs), obtiens ton titre foncier puis fais bâtir ta maison dans l’appli Immobilier.',
  "descEn" = 'Construction company: buy land (Adidogomé estate or elsewhere), obtain your land title, then have your house built in the Real estate app.'
WHERE id = 'btp';
