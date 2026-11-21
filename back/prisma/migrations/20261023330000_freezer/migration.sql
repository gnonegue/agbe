-- Congélateur : drapeau sur le personnage et stock de portions par plat.
ALTER TABLE "character" ADD COLUMN "hasFreezer" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "freezer_item" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "foodId" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "freezer_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "freezer_item_characterId_foodId_key" ON "freezer_item"("characterId", "foodId");

ALTER TABLE "freezer_item" ADD CONSTRAINT "freezer_item_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
