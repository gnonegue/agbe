-- Atelier de lavage auto-moto à Hédzranawoé, au nord de la station Zener : lieu de travail des laveurs de voitures
-- (avant, le carrefour Déckon, un lieu de sortie). Idempotent.
INSERT INTO "venue" ("id","emoji","nameFr","nameEn","districtFr","districtEn","descFr","descEn","city","x","z","app","enabled") VALUES
('lavage_auto', '🧽', 'Lavage Auto-Moto Hédzranawoé', 'Hédzranawoé Car & Bike Wash', 'Hédzranawoé', 'Hédzranawoé', 'Station de lavage de quartier : nettoyeur haute pression, citerne d’eau, savon et aspirateur. Les laveurs de voitures et de motos travaillent ici.', 'Neighbourhood wash bay: pressure washer, water tank, soap and vacuum. Car and motorbike washers work here.', 'lome', 138, -87, 'work', true)
ON CONFLICT ("id") DO NOTHING;

-- Réglage déjà enregistré par l'administration : on ne déplace le laveur que s'il pointe encore vers Déckon
UPDATE "game_setting"
SET "value" = "value" || '{"car_washer":"lavage_auto"}'::jsonb
WHERE "key" = 'work.places' AND jsonb_typeof("value") = 'object' AND "value"->>'car_washer' IN ('deckon', 'station_total');
