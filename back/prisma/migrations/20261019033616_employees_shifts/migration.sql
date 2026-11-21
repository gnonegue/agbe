-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "roleFr" VARCHAR(48) NOT NULL,
    "roleEn" VARCHAR(48) NOT NULL,
    "grossMonthly" INTEGER NOT NULL,
    "hiredDay" INTEGER NOT NULL,
    "cnssNumber" VARCHAR(20),
    "lastPaidMonth" INTEGER NOT NULL DEFAULT -1,
    "hiredMonth" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_shift" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "sourceId" VARCHAR(32) NOT NULL,
    "orders" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "work_shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_cnssNumber_key" ON "employee"("cnssNumber");

-- CreateIndex
CREATE INDEX "employee_companyId_idx" ON "employee"("companyId");

-- CreateIndex
CREATE INDEX "work_shift_characterId_closedAt_idx" ON "work_shift"("characterId", "closedAt");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
