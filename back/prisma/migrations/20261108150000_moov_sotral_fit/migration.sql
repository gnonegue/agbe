-- Moov (reculé de 4 m au total) et gare Sotral (réduite à 65 %) tiennent dos à dos entre la rue du sud et la route du nord, qui remonte
-- jusqu'à z = -104 près du rond-point : le siège passe de -86 à -84 et la gare de -100 à -97.
UPDATE venue SET z = -84 WHERE id = 'moov_africa';
UPDATE venue SET z = -97 WHERE id = 'gare_sotral';
