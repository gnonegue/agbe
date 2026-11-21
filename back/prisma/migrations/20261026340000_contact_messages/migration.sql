-- Formulaire de contact des annonceurs (page « Annonces » du site) : messages et réponses de l'équipe.
-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'READ', 'DONE');

-- CreateTable
CREATE TABLE "contact_message" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "company" VARCHAR(80),
    "whatsapp" VARCHAR(16) NOT NULL,
    "email" VARCHAR(120),
    "topic" VARCHAR(16) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "locale" VARCHAR(2) NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_reply" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "channel" VARCHAR(8) NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "byId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_message_status_createdAt_idx" ON "contact_message"("status", "createdAt");

-- CreateIndex
CREATE INDEX "contact_reply_messageId_idx" ON "contact_reply"("messageId");

-- AddForeignKey
ALTER TABLE "contact_reply" ADD CONSTRAINT "contact_reply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "contact_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

