-- CNSS replacée sur le boulevard, station-service juste avant elle (Total Lomé 2 / MRS près du rond-point GTA),
-- marché et station d'Hédzranawoé séparés, et nouvelle gare des bus urbains Sotral.
UPDATE venue SET x = -30, z = -150 WHERE id = 'cnss';
UPDATE venue SET x = -52, z = -174, "districtFr" = 'Lomé 2', "districtEn" = 'Lomé 2',
  "descFr" = 'Station-service juste avant la CNSS, sur le boulevard Eyadéma : plein d’essence, entretien et réparations.',
  "descEn" = 'Petrol station just before the CNSS, on Boulevard Eyadéma: fuel, servicing and repairs.' WHERE id = 'station_boulevard';
UPDATE venue SET x = 104, z = -128 WHERE id = 'marche_hedzranawoe';
UPDATE venue SET x = 128, z = -116 WHERE id = 'station_total';
INSERT INTO venue (id, emoji, "nameFr", "nameEn", "districtFr", "districtEn", "descFr", "descEn", x, z) VALUES
 ('gare_sotral', '🚌', 'Gare Sotral', 'Sotral bus station', 'Tokoin', 'Tokoin', 'La gare des bus urbains de la Sotral : lignes de la ville, abris et guichet.', 'The Sotral city-bus station: city lines, shelters and ticket office.', -96, -96)
ON CONFLICT (id) DO NOTHING;

-- Seconde station-service avant la CNSS, à gauche en venant du carrefour GTA (Total Lomé 2).
INSERT INTO venue (id, emoji, "nameFr", "nameEn", "districtFr", "districtEn", "descFr", "descEn", x, z) VALUES
 ('station_lome2', '⛽', 'Station TotalEnergies Lomé 2', 'TotalEnergies Lomé 2 station', 'Lomé 2', 'Lomé 2', 'Station-service à gauche en allant du carrefour GTA vers la CNSS : plein d’essence, entretien et réparations.', 'Petrol station on the left going from GTA junction towards the CNSS: fuel, servicing and repairs.', 42, -190)
ON CONFLICT (id) DO NOTHING;

-- Siège de GTA Assurances (OSM : 6.19129 N, 1.20913 E), au sud du rond-point GTA.
INSERT INTO venue (id, emoji, "nameFr", "nameEn", "districtFr", "districtEn", "descFr", "descEn", x, z) VALUES
 ('gta_assurance', '🛡️', 'GTA Assurances – Siège', 'GTA Assurances headquarters', 'Rond-point GTA, boulevard Eyadéma', 'GTA roundabout, Boulevard Eyadéma', 'Siège de la compagnie d’assurances GTA, juste au sud du rond-point auquel elle donne son nom.', 'Head office of the GTA insurance company, just south of the roundabout that bears its name.', -16, -168)
ON CONFLICT (id) DO NOTHING;

-- Le rond-point GTA est bien en amont de la CNSS ; la gare d'Agbalépédogan (OSM : 6.1985 N, 1.2012 E) est plus loin
-- au nord-ouest, sur la route des Deux Lions, et non collée à GTA Assurances et à la station-service.
UPDATE venue SET x = -40, z = -134 WHERE id = 'cnss';
UPDATE venue SET x = -52, z = -236 WHERE id = 'agbalepedo';

-- CNSS (OSM : emprise 6.1880–6.1906 N, 1.2088–1.2109 E) : dans le coin entre l'avenue de la Chance et le boulevard Eyadéma,
-- juste au sud du rond-point GTA. Les deux stations et GTA Assurances sont décalées pour lui laisser la place.
UPDATE venue SET x = -18, z = -160 WHERE id = 'cnss';
UPDATE venue SET x = -27, z = -191 WHERE id = 'gta_assurance';
UPDATE venue SET x = -55, z = -196 WHERE id = 'station_boulevard';

-- CNSS reculée vers le boulevard et le sud pour dégager la route à l'arrière du bâtiment.
UPDATE venue SET x = -16, z = -156 WHERE id = 'cnss';

-- La gare d'Agbalépédogan prend la place de la station-service ; la station passe en face, de l'autre côté de la route.
UPDATE venue SET x = -55, z = -196 WHERE id = 'agbalepedo';
UPDATE venue SET x = -22, z = -230 WHERE id = 'station_boulevard';
