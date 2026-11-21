-- CreateTable
CREATE TABLE "hotel_stay" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "venueId" VARCHAR(32) NOT NULL,
    "roomType" VARCHAR(24) NOT NULL,
    "fromDay" INTEGER NOT NULL,
    "toDay" INTEGER NOT NULL,
    "paid" BIGINT NOT NULL,
    "checkedOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_stay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hall_booking" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "venueId" VARCHAR(32) NOT NULL,
    "hallId" VARCHAR(24) NOT NULL,
    "day" INTEGER NOT NULL,
    "paid" BIGINT NOT NULL,
    "ceremonyId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hall_booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_stay_venueId_roomType_toDay_idx" ON "hotel_stay"("venueId", "roomType", "toDay");

-- CreateIndex
CREATE INDEX "hotel_stay_characterId_toDay_idx" ON "hotel_stay"("characterId", "toDay");

-- CreateIndex
CREATE INDEX "hall_booking_characterId_idx" ON "hall_booking"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "hall_booking_venueId_hallId_day_key" ON "hall_booking"("venueId", "hallId", "day");

-- AddForeignKey
ALTER TABLE "hotel_stay" ADD CONSTRAINT "hotel_stay_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hall_booking" ADD CONSTRAINT "hall_booking_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hotel_stay" ADD CONSTRAINT "hotel_stay_days" CHECK ("toDay" > "fromDay");
ALTER TABLE "hotel_stay" ADD CONSTRAINT "hotel_stay_paid_nonneg" CHECK ("paid" >= 0);
ALTER TABLE "hall_booking" ADD CONSTRAINT "hall_booking_paid_nonneg" CHECK ("paid" >= 0);
