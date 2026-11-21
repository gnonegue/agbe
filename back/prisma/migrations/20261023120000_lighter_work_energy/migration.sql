-- Le travail coûte moins d'énergie : coût des séances divisé par deux environ (hors métiers déjà très légers).
UPDATE job SET "energyCost" = CASE id
  WHEN 'zem_driver' THEN 12
  WHEN 'delivery_driver' THEN 11
  WHEN 'street_vendor' THEN 9
  WHEN 'car_washer' THEN 10
  WHEN 'tailor' THEN 7
  WHEN 'accountant' THEN 7
  ELSE GREATEST(4, ROUND("energyCost" * 0.5)::int)
END;
