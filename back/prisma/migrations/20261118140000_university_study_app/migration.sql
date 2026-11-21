-- Université : raccourcis vers l'appli Éducation (inscription, formations, cours, conférences) sur la fiche du lieu.
UPDATE "venue" SET "app" = 'study' WHERE "id" = 'universite' AND "app" IS NULL;
