-- Cases de pub : de 300 à 900 FCFA la case et la semaine selon le lieu, dans les mêmes proportions qu'avant
-- (est de la ville 300, lagunes 600, mer 900). Le panneau en ville et les formules partenaires ne changent pas.
-- Seuls les prix encore à leur valeur précédente changent : un tarif déjà modifié dans /admin est conservé.
UPDATE "product" SET "priceAmount" = 900 WHERE "id" = 'plot_sea' AND "priceAmount" = 200;
UPDATE "product" SET "priceAmount" = 600 WHERE "id" IN ('plot_lac_ouest', 'plot_lac_est') AND "priceAmount" = 150;
UPDATE "product" SET "priceAmount" = 300 WHERE "id" = 'plot_east' AND "priceAmount" = 100;
