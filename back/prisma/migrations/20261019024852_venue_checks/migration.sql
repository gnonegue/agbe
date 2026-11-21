-- Garde-fous en base pour les lieux et activités (le serveur fixe les prix, jamais le client).
ALTER TABLE "venue_activity" ADD CONSTRAINT "venue_activity_price_nonneg" CHECK ("price" >= 0 AND "price" <= 100000000);
ALTER TABLE "venue_activity" ADD CONSTRAINT "venue_activity_effects_range" CHECK (
  "hunger" BETWEEN -100 AND 100 AND "energy" BETWEEN -100 AND 100 AND "hygiene" BETWEEN -100 AND 100 AND
  "health" BETWEEN -100 AND 100 AND "morale" BETWEEN -100 AND 100 AND "respect" BETWEEN -100 AND 100
);
