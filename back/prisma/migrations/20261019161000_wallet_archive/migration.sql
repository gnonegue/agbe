-- AlterTable
ALTER TABLE "wallet" ADD COLUMN     "archivedAt" TIMESTAMP(3);


-- Un portefeuille appartient soit à un personnage, soit au système ; ou bien il est archivé
-- (vie terminée) : alors sans propriétaire et à solde nul, ce qui interdit tout mouvement ultérieur.
ALTER TABLE "wallet" DROP CONSTRAINT "wallet_owner_xor";
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_owner_xor"
  CHECK (
    ("archivedAt" IS NULL AND (("characterId" IS NULL) <> ("systemCode" IS NULL)))
    OR ("archivedAt" IS NOT NULL AND "characterId" IS NULL AND "systemCode" IS NULL AND "balance" = 0)
  );
