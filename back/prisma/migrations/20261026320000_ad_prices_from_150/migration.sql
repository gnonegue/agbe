-- Cases de pub : dès 150 FCFA la case et la semaine, mêmes proportions selon le lieu
-- (est de la ville 150, lagunes 225, mer 300) : une affiche 6 × 6 en mer reste moins chère qu'un panneau en ville.
-- Seuls les prix encore à leur valeur précédente changent : un tarif déjà modifié dans /admin est conservé.
UPDATE "product" SET "priceAmount" = 300 WHERE "id" = 'plot_sea' AND "priceAmount" = 900;
UPDATE "product" SET "priceAmount" = 225 WHERE "id" IN ('plot_lac_ouest', 'plot_lac_est') AND "priceAmount" = 600;
UPDATE "product" SET "priceAmount" = 150 WHERE "id" = 'plot_east' AND "priceAmount" = 300;
