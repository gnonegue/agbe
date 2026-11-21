-- Aire de lavage installée sur la dalle de la station Zener de Hédzranawoé (côté ouest, entre la boutique et les pompes),
-- à l'intérieur de l'emprise de la station : aucun espace vert libre n'existait autour.
UPDATE "venue" SET "x" = 131, "z" = -124,
  "descFr" = 'Aire de lavage de la station Zener : nettoyeur haute pression, citerne d’eau, savon et aspirateur. Les laveurs de voitures et de motos travaillent ici.',
  "descEn" = 'Zener station wash bay: pressure washer, water tank, soap and vacuum. Car and motorbike washers work here.'
WHERE "id" = 'lavage_auto';
