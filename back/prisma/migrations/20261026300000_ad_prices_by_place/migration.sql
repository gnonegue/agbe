-- Cases de pub : un prix par lieu (produit `plot_<espace>`), par case et par semaine.
-- Repère : Lagos Life loue une parcelle 6 × 6 en lagune ₦18 000 la semaine (≈ 7 700 FCFA, soit ≈ 215 FCFA la case).
-- Les prix se modifient ensuite dans /admin (Produits) ; un tarif existant n'est jamais écrasé.
INSERT INTO "product" ("id", "kind", "nameFr", "nameEn", "priceAmount", "currency", "coinsGranted", "active") VALUES
  ('plot_sea', 'AD_PLOT', 'Case de pub en mer, par semaine', 'Sea ad square, per week', 200, 'XOF', 0, true),
  ('plot_lac_ouest', 'AD_PLOT', 'Case de pub Lac Ouest, par semaine', 'West Lagoon ad square, per week', 150, 'XOF', 0, true),
  ('plot_lac_est', 'AD_PLOT', 'Case de pub Lac Est (Bè), par semaine', 'East Lagoon (Bè) ad square, per week', 150, 'XOF', 0, true),
  ('plot_east', 'AD_PLOT', 'Case de pub est de la ville, par semaine', 'East of the city ad square, per week', 100, 'XOF', 0, true)
ON CONFLICT ("id") DO NOTHING;

-- Ancien tarif unique (1 000 FCFA la case pour 10 jours, tous lieux confondus) : retiré de la vente, gardé pour l'historique des achats.
UPDATE "product" SET "active" = false WHERE "id" = 'plot_30d';

-- Durée des cases alignée sur les panneaux : à la semaine (1, 2 ou 4 semaines), si l'ancienne valeur n'avait pas été modifiée.
UPDATE "game_setting" SET "value" = '{"days": 7, "counts": [1, 2, 4]}'::jsonb
WHERE "key" = 'ad.plots.period' AND "value" = '{"days": 10, "counts": [1, 2, 3]}'::jsonb;
