-- Séance de cours : le joueur s'assoit en classe, suit le cours jusqu'à la fin, puis répond à la question.
ALTER TABLE "enrollment" ADD COLUMN "classDay" INTEGER NOT NULL DEFAULT -1;

-- « Cours du soir (découverte) » se confondait avec les cours payés à l'inscription : c'est une conférence publique.
UPDATE "venue_activity" SET "emoji" = '🎤', "nameFr" = 'Conférence publique (sans inscription)', "nameEn" = 'Public lecture (no enrolment)' WHERE "id" = 'univ_cours';
