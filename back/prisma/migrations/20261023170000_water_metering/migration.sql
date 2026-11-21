-- Les douches ne se paient plus sur le moment : elles sont comptées et facturées avec l'eau du mois.
ALTER TABLE "character" ADD COLUMN "waterShowers" INTEGER NOT NULL DEFAULT 0;
