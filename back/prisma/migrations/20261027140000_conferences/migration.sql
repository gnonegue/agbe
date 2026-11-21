-- Conférences publiques programmées : une place par joueur et par jour, payée à l'entrée, récompensée à la fin.
CREATE TABLE "conference_seat" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "topicId" VARCHAR(32) NOT NULL,
    "rewarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conference_seat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conference_seat_characterId_day_key" ON "conference_seat"("characterId", "day");

ALTER TABLE "conference_seat" ADD CONSTRAINT "conference_seat_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- L'ancienne « conférence » achetable à toute heure est remplacée par les conférences programmées.
UPDATE "venue_activity" SET "enabled" = false WHERE "id" = 'univ_cours';
