-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');

-- AlterTable
ALTER TABLE "character" ADD COLUMN     "mutedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" UUID NOT NULL,
    "room" VARCHAR(48) NOT NULL,
    "characterId" UUID NOT NULL,
    "text" VARCHAR(280) NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "messageId" UUID,
    "reason" VARCHAR(24) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" UUID,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_message_room_createdAt_idx" ON "chat_message"("room", "createdAt");

-- CreateIndex
CREATE INDEX "chat_message_characterId_createdAt_idx" ON "chat_message"("characterId", "createdAt");

-- CreateIndex
CREATE INDEX "report_status_createdAt_idx" ON "report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "report_targetId_idx" ON "report"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "report_reporterId_messageId_key" ON "report"("reporterId", "messageId");

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
