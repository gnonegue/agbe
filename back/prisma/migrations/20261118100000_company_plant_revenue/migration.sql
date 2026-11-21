-- Chiffre d'affaires des usines et sites d'une entreprise : déclaré avec elle à l'OTR, soumis à l'impôt OTR seulement.
ALTER TABLE "company" ADD COLUMN "pendingPlantRevenue" BIGINT NOT NULL DEFAULT 0;
