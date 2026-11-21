-- CreateEnum
CREATE TYPE "CompanyForm" AS ENUM ('EI', 'SARL', 'SA');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PENDING_CFE', 'REGISTERED', 'CLOSED');

-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "activityId" VARCHAR(32) NOT NULL,
    "form" "CompanyForm" NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'PENDING_CFE',
    "readyAt" TIMESTAMP(3) NOT NULL,
    "rccm" VARCHAR(40),
    "nif" VARCHAR(20),
    "cnssNumber" VARCHAR(20),
    "lastWorkedAt" TIMESTAMP(3),
    "lastDeclaredMonth" INTEGER NOT NULL DEFAULT -1,
    "createdMonth" INTEGER NOT NULL,
    "revenue" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_characterId_key" ON "company"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "company_rccm_key" ON "company"("rccm");

-- CreateIndex
CREATE UNIQUE INDEX "company_nif_key" ON "company"("nif");

-- CreateIndex
CREATE UNIQUE INDEX "company_cnssNumber_key" ON "company"("cnssNumber");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

