-- AlterTable
ALTER TABLE "character" ADD COLUMN     "city" VARCHAR(16) NOT NULL DEFAULT 'lome',
ADD COLUMN     "tripUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "venue" ADD COLUMN     "city" VARCHAR(16) NOT NULL DEFAULT 'lome';

-- CreateIndex
CREATE INDEX "venue_city_idx" ON "venue"("city");
