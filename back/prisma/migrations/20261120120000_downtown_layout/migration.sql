-- Centre-ville réorganisé : Grand Marché agrandi dans l'îlot du Palais, cathédrale juste à l'est (de l'autre côté de l'avenue),
-- lieux de la bande est espacés ; BOAD seule au centre de son îlot (les logements des joueurs partent au quartier résidentiel ouest).
UPDATE venue SET x = 74, z = -46 WHERE id = 'marche_assigame';
UPDATE venue SET x = 121, z = -41 WHERE id = 'deckon';
UPDATE venue SET x = 137, z = -41 WHERE id = 'kiosque_momo';
UPDATE venue SET x = 137, z = -58 WHERE id = 'maquis_be';
UPDATE venue SET x = 69, z = -86 WHERE id = 'boad';
UPDATE venue SET x = 121, z = -59 WHERE id = 'bank_boa_2';
UPDATE venue SET x = 49, z = -90 WHERE id = 'bank_orabank_2';
UPDATE venue SET x = 103, z = -44 WHERE id = 'cathedrale';
