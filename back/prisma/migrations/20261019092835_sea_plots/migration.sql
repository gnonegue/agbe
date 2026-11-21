-- AlterEnum
ALTER TYPE "ProductKind" ADD VALUE 'AD_PLOT';

-- AlterTable
ALTER TABLE "campaign" ADD COLUMN     "plotH" INTEGER,
ADD COLUMN     "plotW" INTEGER,
ADD COLUMN     "plotX" INTEGER,
ADD COLUMN     "plotY" INTEGER;

