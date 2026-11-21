-- Recalage de la maquette de Lomé ; conserve les autres données des lieux.
UPDATE venue SET x = 52, z = -56 WHERE id = 'palais_congres';
UPDATE venue SET x = 26, z = -50 WHERE id = 'monument';
UPDATE venue SET x = 15, z = -18 WHERE id = 'hotel_2fevrier';
UPDATE venue SET x = 69, z = -39 WHERE id = 'marche_assigame';
UPDATE venue SET x = 82, z = -39 WHERE id = 'cathedrale';
UPDATE venue SET x = -30, z = -163 WHERE id = 'cnss';
UPDATE venue SET x = 21, z = -155 WHERE id = 'otr';
UPDATE venue SET x = 17, z = -186 WHERE id = 'yas';
UPDATE venue SET x = -91, z = -240 WHERE id = 'eza_zozo';
UPDATE venue SET x = 132, z = -253 WHERE id = 'echangeur_kegue';
UPDATE venue SET x = 0, z = -358 WHERE id = 'echangeur_agoe';
UPDATE venue SET x = 90, z = -110 WHERE id = 'colombe_paix';
