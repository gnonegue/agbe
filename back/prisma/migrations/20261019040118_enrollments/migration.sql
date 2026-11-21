-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "courseId" VARCHAR(32) NOT NULL,
    "sessionsDone" INTEGER NOT NULL DEFAULT 0,
    "correctAnswers" INTEGER NOT NULL DEFAULT 0,
    "lastSessionDay" INTEGER NOT NULL DEFAULT -1,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_characterId_courseId_key" ON "enrollment"("characterId", "courseId");

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
