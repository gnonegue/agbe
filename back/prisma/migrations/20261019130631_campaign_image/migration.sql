-- CreateTable
CREATE TABLE "campaign_image" (
    "campaignId" UUID NOT NULL,
    "mime" VARCHAR(16) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_image_pkey" PRIMARY KEY ("campaignId")
);

