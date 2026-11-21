-- CreateTable
CREATE TABLE "savings_account" (
    "characterId" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "lastAccruedDay" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_account_pkey" PRIMARY KEY ("characterId")
);

