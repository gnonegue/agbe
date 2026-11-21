-- AlterTable
ALTER TABLE "account" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER;
