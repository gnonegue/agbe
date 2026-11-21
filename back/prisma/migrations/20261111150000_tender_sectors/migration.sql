-- Marchés publics couvrant plusieurs domaines
ALTER TABLE "public_tender" ADD COLUMN "sectors" TEXT[] DEFAULT ARRAY[]::TEXT[];
