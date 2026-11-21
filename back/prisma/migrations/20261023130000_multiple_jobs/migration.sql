-- Plusieurs métiers à la fois : liste des métiers occupés (le métier actif reste dans "jobId").
ALTER TABLE "character" ADD COLUMN "jobIds" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[];
UPDATE "character" SET "jobIds" = ARRAY["jobId"]::VARCHAR(32)[] WHERE "jobId" IS NOT NULL;
UPDATE "character" SET "jobIds" = ARRAY[]::VARCHAR(32)[] WHERE "jobIds" IS NULL;
ALTER TABLE "character" ALTER COLUMN "jobIds" SET NOT NULL;
