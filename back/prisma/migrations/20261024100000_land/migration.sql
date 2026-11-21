-- Foncier : terrains vendus par quarts de lot (150 m²), titre foncier, exploitation et revente entre joueurs.

-- CreateTable
CREATE TABLE "land_holding" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "zoneId" VARCHAR(24) NOT NULL,
    "cell" INTEGER NOT NULL,
    "quarters" INTEGER NOT NULL,
    "paid" BIGINT NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'BOUGHT',
    "stepTarget" VARCHAR(10),
    "stepReadyAt" TIMESTAMP(3),
    "titleNo" VARCHAR(24),
    "useId" VARCHAR(32),
    "useCost" BIGINT NOT NULL DEFAULT 0,
    "useReadyAt" TIMESTAMP(3),
    "useCollected" BIGINT NOT NULL DEFAULT 0,
    "movedIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "land_holding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "land_holding_quarters_check" CHECK ("quarters" BETWEEN 1 AND 4),
    CONSTRAINT "land_holding_paid_check" CHECK ("paid" >= 0),
    CONSTRAINT "land_holding_use_check" CHECK ("useCost" >= 0 AND "useCollected" >= 0)
);

-- CreateTable
CREATE TABLE "land_quarter" (
    "zoneId" VARCHAR(24) NOT NULL,
    "cell" INTEGER NOT NULL,
    "q" INTEGER NOT NULL,
    "holdingId" UUID NOT NULL,

    CONSTRAINT "land_quarter_pkey" PRIMARY KEY ("zoneId","cell","q"),
    CONSTRAINT "land_quarter_q_check" CHECK ("q" BETWEEN 0 AND 3 AND "cell" >= 0)
);

-- CreateTable
CREATE TABLE "land_listing" (
    "holdingId" UUID NOT NULL,
    "ask" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "land_listing_pkey" PRIMARY KEY ("holdingId"),
    CONSTRAINT "land_listing_ask_check" CHECK ("ask" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "land_holding_titleNo_key" ON "land_holding"("titleNo");

-- CreateIndex
CREATE INDEX "land_holding_characterId_idx" ON "land_holding"("characterId");

-- CreateIndex
CREATE INDEX "land_holding_zoneId_cell_idx" ON "land_holding"("zoneId", "cell");

-- CreateIndex
CREATE INDEX "land_quarter_holdingId_idx" ON "land_quarter"("holdingId");

-- AddForeignKey
ALTER TABLE "land_holding" ADD CONSTRAINT "land_holding_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "land_quarter" ADD CONSTRAINT "land_quarter_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "land_holding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "land_listing" ADD CONSTRAINT "land_listing_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "land_holding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
