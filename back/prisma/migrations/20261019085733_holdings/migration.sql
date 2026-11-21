-- CreateTable
CREATE TABLE "holding" (
    "characterId" UUID NOT NULL,
    "goodId" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL,
    "cost" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holding_pkey" PRIMARY KEY ("characterId","goodId")
);

