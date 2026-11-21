-- La station de zémidjans devient le siège-station Gozem (tour de 5 étages côté 3D).
UPDATE venue SET
  "nameFr" = 'Gozem — Station de zémidjans',
  "nameEn" = 'Gozem — Zémidjan hub',
  "descFr" = 'Le siège-station Gozem, tour de 5 étages : courses en moto-taxi, livraison en tricycle, Gozem Money, garage et assistance. Devant, l’abri des conducteurs indépendants : les petits boulots de débrouille commencent ici.',
  "descEn" = 'The Gozem headquarters-station, a 5-storey tower: moto-taxi rides, tricycle delivery, Gozem Money, garage and support. Out front, the shelter of independent riders: odd jobs start here.'
WHERE id = 'station_zem';
