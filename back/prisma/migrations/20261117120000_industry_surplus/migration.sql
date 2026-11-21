-- Industrie : surproduction, stock invendu à brader ou à garder pour une meilleure saison.
ALTER TABLE "industry_plant" ADD COLUMN "stockValue" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "industry_plant" ADD CONSTRAINT "industry_plant_stock_check" CHECK ("stockValue" >= 0);
ALTER TABLE "industry_plant" ADD COLUMN "staffChangedDay" INTEGER;
