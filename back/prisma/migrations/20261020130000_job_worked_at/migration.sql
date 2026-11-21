-- AlterTable
ALTER TABLE "character" ADD COLUMN "jobWorkedAt" JSONB NOT NULL DEFAULT '{}';

-- Reprise : la dernière séance connue compte pour le métier actuel
UPDATE "character" SET "jobWorkedAt" = jsonb_build_object("jobId", to_char("lastWorkedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE "jobId" IS NOT NULL AND "lastWorkedAt" IS NOT NULL;
