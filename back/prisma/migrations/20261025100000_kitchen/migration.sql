-- CreateTable
CREATE TABLE "kitchen_appliance" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "applianceId" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kitchen_appliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pantry_lot" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "itemId" VARCHAR(40) NOT NULL,
    "qty" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pantry_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_appliance_characterId_applianceId_key" ON "kitchen_appliance"("characterId", "applianceId");

-- CreateIndex
CREATE INDEX "pantry_lot_characterId_itemId_idx" ON "pantry_lot"("characterId", "itemId");

-- AddForeignKey
ALTER TABLE "kitchen_appliance" ADD CONSTRAINT "kitchen_appliance_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_lot" ADD CONSTRAINT "pantry_lot_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

