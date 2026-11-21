-- AlterTable : dernière séance par loisir à la maison { tv: date ISO, read: date ISO }
ALTER TABLE "character" ADD COLUMN "leisureAt" JSONB NOT NULL DEFAULT '{}';
