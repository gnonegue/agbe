-- Partenaire montré dans la section « Nos partenaires » du site public (coché dans /admin).
ALTER TABLE "partner" ADD COLUMN "showOnSite" BOOLEAN NOT NULL DEFAULT false;
