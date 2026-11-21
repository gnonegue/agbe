-- Garde-fous : chiffre d'affaires non négatif, nom non vide.
ALTER TABLE "company" ADD CONSTRAINT "company_revenue_nonneg" CHECK ("pendingRevenue" >= 0);
ALTER TABLE "company" ADD CONSTRAINT "company_name_nonempty" CHECK (length(trim("name")) >= 2);
