-- Palais des Congrès agrandi, seul dans son îlot ; Grand Marché juste à l'est de l'avenue, cathédrale à l'est du marché ;
-- maquis Deckon et Bè à l'est de l'îlot du Palais, BOA et kiosque au bout de la bande est.
UPDATE venue SET x = 57, z = -50 WHERE id = 'palais_congres';
UPDATE venue SET x = 110, z = -48 WHERE id = 'marche_assigame';
UPDATE venue SET x = 131, z = -46 WHERE id = 'cathedrale';
UPDATE venue SET x = 78, z = -41 WHERE id = 'deckon';
UPDATE venue SET x = 78, z = -58 WHERE id = 'maquis_be';
UPDATE venue SET x = 143, z = -58 WHERE id = 'bank_boa_2';
UPDATE venue SET x = 143, z = -35 WHERE id = 'kiosque_momo';
