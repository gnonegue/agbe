-- Métiers structurés : mécanicien moto, serveur d'hôtel, barbier et conducteur de tricycle cargo demandent un certificat
-- (apprentissage chez un patron, formation en hôtellerie, auto-école) obtenu dans l'appli École.
UPDATE job SET level = 'QUALIFIE' WHERE id IN ('moto_mechanic', 'hotel_waiter', 'barber', 'cargo_rider');
