-- La gare d'Agbalépédogan passe en face de la station-service (de l'autre côté de la route) ; son ancienne place revient aux habitations.
-- GTA Assurances se déplace à l'ouest pour libérer la place.
UPDATE venue SET x = -40, z = -190 WHERE id = 'agbalepedo';
UPDATE venue SET x = -95, z = -175 WHERE id = 'gta_assurance';
