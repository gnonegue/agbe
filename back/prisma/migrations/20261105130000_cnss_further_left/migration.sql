-- La CNSS est encore décalée vers l'ouest (la gauche de la carte), côté pelouses, pour libérer le boulevard Eyadéma.
UPDATE "venue" SET "x" = -27 WHERE "id" = 'cnss';
