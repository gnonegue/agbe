-- BOAD replacée au nord du Grand Marché (relevé OSM : ~1,1 km au nord du marché, à peine à l'est) ; Moov Africa et la gare
-- Sotral prennent l'îlot qu'elle libère (gare côté boulevard nord, Moov face à la rue du sud).
UPDATE venue SET x = 110, z = -88 WHERE id = 'boad';
UPDATE venue SET x = 70, z = -82 WHERE id = 'moov_africa';
UPDATE venue SET x = 70, z = -97 WHERE id = 'gare_sotral';
