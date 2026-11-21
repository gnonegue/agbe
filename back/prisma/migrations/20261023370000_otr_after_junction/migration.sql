-- L'OTR est replacé le long du boulevard, juste après le carrefour OTR ; l'ambassade des États-Unis reprend sa place en face du CHU Campus.
UPDATE venue SET x = 21, z = -146 WHERE id = 'otr';
UPDATE venue SET x = 18, z = -126 WHERE id = 'amb_usa';
