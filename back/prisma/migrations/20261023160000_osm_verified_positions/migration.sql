-- Positions vérifiées sur OpenStreetMap (voir docs/lome-map-calibration.md) : la Direction générale Togo Télécom / Yas,
-- la Nouvelle Présidence et le CHR Lomé-Commune se suivent d'ouest en est le long de la route de la Nouvelle Présidence
-- puis du boulevard Jean-Paul II ; YAS et la Présidence sont au sud de cette route et lui tournent le dos.
UPDATE venue SET x = 38, z = -164 WHERE id = 'yas';
UPDATE venue SET x = 80, z = -154 WHERE id = 'presidence';
UPDATE venue SET x = 112, z = -205 WHERE id = 'chr_commune';
