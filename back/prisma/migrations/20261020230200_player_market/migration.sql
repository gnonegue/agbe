-- CreateTable
CREATE TABLE "stall" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "venueId" VARCHAR(32) NOT NULL,
    "paidUntilDay" INTEGER NOT NULL,
    "sales" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stall_item" (
    "id" UUID NOT NULL,
    "stallId" UUID NOT NULL,
    "goodId" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "stall_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_item" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "goodId" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stall_characterId_key" ON "stall"("characterId");

-- CreateIndex
CREATE INDEX "stall_venueId_paidUntilDay_idx" ON "stall"("venueId", "paidUntilDay");

-- CreateIndex
CREATE UNIQUE INDEX "stall_item_stallId_goodId_key" ON "stall_item"("stallId", "goodId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_characterId_goodId_key" ON "inventory_item"("characterId", "goodId");

-- AddForeignKey
ALTER TABLE "stall" ADD CONSTRAINT "stall_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_item" ADD CONSTRAINT "stall_item_stallId_fkey" FOREIGN KEY ("stallId") REFERENCES "stall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stall_item" ADD CONSTRAINT "stall_item_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "stall_item" ADD CONSTRAINT "stall_item_price_positive" CHECK ("price" > 0);
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "stall" ADD CONSTRAINT "stall_sales_nonneg" CHECK ("sales" >= 0);
