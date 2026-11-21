-- Industrie : usines et zones franches à acheter, employés, investisseurs PNJ au capital.
CREATE TABLE "industry_plant" (
    "id" UUID NOT NULL,
    "catalogId" VARCHAR(32) NOT NULL,
    "unit" INTEGER NOT NULL DEFAULT 0,
    "characterId" UUID NOT NULL,
    "paid" BIGINT NOT NULL,
    "staff" INTEGER NOT NULL DEFAULT 0,
    "pending" BIGINT NOT NULL DEFAULT 0,
    "accruedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "investorId" VARCHAR(32),
    "investorBp" INTEGER NOT NULL DEFAULT 0,
    "askPrice" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "industry_plant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "industry_plant_staff_check" CHECK ("staff" >= 0),
    CONSTRAINT "industry_plant_investor_check" CHECK ("investorBp" BETWEEN 0 AND 10000),
    CONSTRAINT "industry_plant_paid_check" CHECK ("paid" >= 0 AND "pending" >= 0)
);
CREATE UNIQUE INDEX "industry_plant_catalogId_unit_key" ON "industry_plant"("catalogId", "unit");
CREATE INDEX "industry_plant_characterId_idx" ON "industry_plant"("characterId");
ALTER TABLE "industry_plant" ADD CONSTRAINT "industry_plant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
