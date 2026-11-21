-- Groupes de discussion privés et trace des envois d'argent dans les conversations.
ALTER TABLE "chat_message" ADD COLUMN "moneyAmount" BIGINT;

CREATE TABLE "chat_group" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_group_member" (
    "groupId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_group_member_pkey" PRIMARY KEY ("groupId","characterId")
);

CREATE INDEX "chat_group_member_characterId_idx" ON "chat_group_member"("characterId");

ALTER TABLE "chat_group" ADD CONSTRAINT "chat_group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_group_member" ADD CONSTRAINT "chat_group_member_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_group_member" ADD CONSTRAINT "chat_group_member_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
