-- CreateTable
CREATE TABLE "diploma" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "domain" VARCHAR(24) NOT NULL,
    "series" VARCHAR(8),
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diploma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "domain" VARCHAR(24) NOT NULL,
    "series" VARCHAR(8),
    "year" INTEGER NOT NULL DEFAULT 1,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "sessionsDone" INTEGER NOT NULL DEFAULT 0,
    "correctAnswers" INTEGER NOT NULL DEFAULT 0,
    "lastSessionDay" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diploma_characterId_kind_domain_key" ON "diploma"("characterId", "kind", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "study_characterId_key" ON "study"("characterId");

-- AddForeignKey
ALTER TABLE "diploma" ADD CONSTRAINT "diploma_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study" ADD CONSTRAINT "study_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

