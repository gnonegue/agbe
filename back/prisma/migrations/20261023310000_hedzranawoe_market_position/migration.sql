-- Marché de Hédzranawoé (OSM/Nominatim : 6.18179 N, 1.24025 E, boulevard Haho) ; la station TotalEnergies voisine est décalée à l'est.
UPDATE venue SET x = 117, z = -129 WHERE id = 'marche_hedzranawoe';
UPDATE venue SET x = 138, z = -116 WHERE id = 'station_total';
