-- Codes de secours à usage unique pour la double authentification (téléphone perdu), hachés SHA-256.
ALTER TABLE "account" ADD COLUMN "totpBackupCodes" TEXT[] NOT NULL DEFAULT '{}';
