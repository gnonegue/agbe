-- Habillement : garde-robe, boutiques de vêtements des joueurs, quatre boutiques de prêt-à-porter à Lomé.
-- CreateTable
CREATE TABLE "garment" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "itemId" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clothing_shop" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "venueId" VARCHAR(32) NOT NULL,
    "paidUntilDay" INTEGER NOT NULL,
    "sales" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clothing_shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clothing_shop_item" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "itemId" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "clothing_shop_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "garment_characterId_itemId_key" ON "garment"("characterId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "clothing_shop_characterId_key" ON "clothing_shop"("characterId");

-- CreateIndex
CREATE INDEX "clothing_shop_venueId_paidUntilDay_idx" ON "clothing_shop"("venueId", "paidUntilDay");

-- CreateIndex
CREATE UNIQUE INDEX "clothing_shop_item_shopId_itemId_key" ON "clothing_shop_item"("shopId", "itemId");

-- AddForeignKey
ALTER TABLE "garment" ADD CONSTRAINT "garment_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clothing_shop" ADD CONSTRAINT "clothing_shop_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clothing_shop_item" ADD CONSTRAINT "clothing_shop_item_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "clothing_shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Garde-fous : stock jamais négatif, prix et loyer strictement positifs
ALTER TABLE "clothing_shop_item" ADD CONSTRAINT "clothing_shop_item_qty_check" CHECK ("qty" >= 0);
ALTER TABLE "clothing_shop_item" ADD CONSTRAINT "clothing_shop_item_price_check" CHECK ("price" > 0);
ALTER TABLE "clothing_shop" ADD CONSTRAINT "clothing_shop_sales_check" CHECK ("sales" >= 0);

-- Boutiques de prêt-à-porter (positions approximatives, à ajuster sur la carte)
INSERT INTO "venue" ("id","emoji","nameFr","nameEn","districtFr","districtEn","descFr","descEn","city","x","z","app","enabled") VALUES
('mode_assigame', '👗', 'Prêt-à-porter du Grand Marché', 'Grand Market Fashion', 'Assigamé', 'Assigamé', 'Grande boutique de mode près du Grand Marché : pagnes, robes, chemises, jeans et chaussures. Des joueurs y louent aussi leur boutique.', 'Large fashion shop by the Grand Market: pagnes, dresses, shirts, jeans and shoes. Players rent their own shops here too.', 'lome', 58, -19, 'clothes', true),
('mode_nyekonakpoe', '👔', 'Mode Nyékonakpoè', 'Nyékonakpoè Fashion', 'Nyékonakpoè', 'Nyékonakpoè', 'Boutique de vêtements de ville : costumes, chemises, tailleurs et chaussures de ville.', 'City clothing shop: suits, shirts, tailored wear and dress shoes.', 'lome', -62, -42, 'clothes', true),
('mode_be', '👟', 'Chaussures et Mode de Bè', 'Bè Shoes & Fashion', 'Bè', 'Bè', 'Baskets, sandales, escarpins et vêtements du quotidien, au cœur de Bè.', 'Sneakers, sandals, heels and everyday clothes, in the heart of Bè.', 'lome', 138, -80, 'clothes', true),
('mode_adidogome', '🛍️', 'Boutique Mode Adidogomé', 'Adidogomé Fashion Shop', 'Adidogomé', 'Adidogomé', 'Prêt-à-porter à petits prix à côté du marché d’Adidogomé.', 'Affordable ready-to-wear next to Adidogomé market.', 'lome', -115, -128, 'clothes', true)
ON CONFLICT ("id") DO NOTHING;
