-- Présentation des métiers dans l'appli Travail : famille, pictogramme et description bilingue.
ALTER TABLE "job" ADD COLUMN "category" VARCHAR(24) NOT NULL DEFAULT 'services';
ALTER TABLE "job" ADD COLUMN "emoji" VARCHAR(8) NOT NULL DEFAULT '💼';
ALTER TABLE "job" ADD COLUMN "descFr" VARCHAR(280) NOT NULL DEFAULT '';
ALTER TABLE "job" ADD COLUMN "descEn" VARCHAR(280) NOT NULL DEFAULT '';
