-- AlterTable
ALTER TABLE "character" ADD COLUMN     "elecPaidUntilGameDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waterPaidUntilGameDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wifiPaidUntilGameDay" INTEGER NOT NULL DEFAULT 0;

-- Personnages existants : électricité et eau payées jusqu'à la même date que le loyer
UPDATE "character" SET "elecPaidUntilGameDay" = "rentPaidUntilGameDay", "waterPaidUntilGameDay" = "rentPaidUntilGameDay";
