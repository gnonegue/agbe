-- Gare Sotral : le siège Moov ayant reculé de 6 m, la gare (réduite à 70 %) passe 8 m plus au nord, derrière lui, sans toucher la route du nord.
UPDATE venue SET z = -100 WHERE id = 'gare_sotral';
