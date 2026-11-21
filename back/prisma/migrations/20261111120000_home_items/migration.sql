-- Meubles posés par les joueurs dans leur logement
CREATE TABLE "home_item" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "housing" VARCHAR(32) NOT NULL,
    "itemId" VARCHAR(32) NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "rot" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "home_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "home_item_characterId_housing_idx" ON "home_item"("characterId", "housing");
ALTER TABLE "home_item" ADD CONSTRAINT "home_item_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
