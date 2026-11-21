-- AlterTable
ALTER TABLE "character" ADD COLUMN     "locationId" VARCHAR(32) NOT NULL DEFAULT 'home';

-- CreateTable
CREATE TABLE "venue" (
    "id" VARCHAR(32) NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "nameFr" VARCHAR(64) NOT NULL,
    "nameEn" VARCHAR(64) NOT NULL,
    "districtFr" VARCHAR(64) NOT NULL,
    "districtEn" VARCHAR(64) NOT NULL,
    "descFr" VARCHAR(400) NOT NULL,
    "descEn" VARCHAR(400) NOT NULL,
    "x" INTEGER NOT NULL,
    "z" INTEGER NOT NULL,
    "app" VARCHAR(16),
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_activity" (
    "id" VARCHAR(32) NOT NULL,
    "venueId" VARCHAR(32) NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "nameFr" VARCHAR(64) NOT NULL,
    "nameEn" VARCHAR(64) NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "hunger" INTEGER NOT NULL DEFAULT 0,
    "energy" INTEGER NOT NULL DEFAULT 0,
    "hygiene" INTEGER NOT NULL DEFAULT 0,
    "health" INTEGER NOT NULL DEFAULT 0,
    "morale" INTEGER NOT NULL DEFAULT 0,
    "respect" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "venue_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venue_activity_venueId_idx" ON "venue_activity"("venueId");

-- AddForeignKey
ALTER TABLE "venue_activity" ADD CONSTRAINT "venue_activity_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
