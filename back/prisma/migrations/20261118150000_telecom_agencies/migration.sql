-- Agences Yas (Mixx) et Moov (Flooz) : démarches mobile money et épargne mobile sur la fiche du lieu.
UPDATE "venue" SET "app" = 'telecom' WHERE "id" IN ('yas', 'moov_africa') AND "app" IS NULL;
