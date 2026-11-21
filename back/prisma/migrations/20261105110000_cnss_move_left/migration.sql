-- La CNSS (avec sa cour élargie) débordait sur le boulevard Eyadéma : décalée de 3 vers l'ouest (la gauche de la carte).
UPDATE "venue" SET "x" = -22 WHERE "id" = 'cnss';
