-- CreateTable
CREATE TABLE "stock_holding" (
    "characterId" UUID NOT NULL,
    "symbol" VARCHAR(8) NOT NULL,
    "qty" INTEGER NOT NULL,
    "cost" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_holding_pkey" PRIMARY KEY ("characterId","symbol")
);

-- CreateTable
CREATE TABLE "venture" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "optionId" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "invested" BIGINT NOT NULL,
    "payout" BIGINT NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "activeDays" INTEGER NOT NULL,
    "collected" BIGINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "venture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venture_characterId_closedAt_idx" ON "venture"("characterId", "closedAt");

