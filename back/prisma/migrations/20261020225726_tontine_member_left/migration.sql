/*
  Warnings:

  - Added the required column `name` to the `tontine_member` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "tontine_member" DROP CONSTRAINT "tontine_member_characterId_fkey";

-- AlterTable
ALTER TABLE "tontine_member" ADD COLUMN     "name" VARCHAR(32) NOT NULL,
ALTER COLUMN "characterId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "tontine_member" ADD CONSTRAINT "tontine_member_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
