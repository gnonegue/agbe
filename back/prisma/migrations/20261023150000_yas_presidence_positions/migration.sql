-- YAS et la Présidence replacés : la Présidence derrière (à l'est de) l'ambassade des États-Unis, YAS avant l'OTR,
-- adossé à la route de la Présidence (z = -176).
UPDATE venue SET x = 36, z = -166 WHERE id = 'yas';
UPDATE venue SET x = 84, z = -160 WHERE id = 'presidence';
