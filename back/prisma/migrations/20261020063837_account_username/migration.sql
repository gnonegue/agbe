-- AlterTable
ALTER TABLE "account" ADD COLUMN "username" VARCHAR(20);

-- CreateIndex
CREATE UNIQUE INDEX "account_username_key" ON "account"("username");
