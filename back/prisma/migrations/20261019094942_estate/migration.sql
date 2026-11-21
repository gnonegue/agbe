-- AlterTable
ALTER TABLE "character" ADD COLUMN     "homeX" INTEGER,
ADD COLUMN     "homeZ" INTEGER;

-- CreateTable
CREATE TABLE "estate_plot" (
    "index" INTEGER NOT NULL,
    "characterId" UUID NOT NULL,
    "boughtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" VARCHAR(32),
    "buildReadyAt" TIMESTAMP(3),
    "movedIn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "estate_plot_pkey" PRIMARY KEY ("index")
);

-- CreateIndex
CREATE UNIQUE INDEX "estate_plot_characterId_key" ON "estate_plot"("characterId");

