-- AlterTable
ALTER TABLE "character" ALTER COLUMN "rentNagDay" SET DEFAULT -1;

-- Parties existantes : le retard accumulé avant les règles de pénalité et d’expulsion est pardonné une fois (voir settleRent)
UPDATE "character" SET "rentNagDay" = -1;
