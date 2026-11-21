-- Marchés publics : prix fixe = budget annoncé (maxBudget), plus d'enchère à la baisse.
-- La sélection ne porte plus que sur le délai proposé (le plus court gagne) ; le paiement verse le montant
-- fixe du marché (maxBudget), jamais un prix candidat. La colonne "proposedPrice" n'a donc plus de sens
-- fonctionnel : elle est supprimée (choix du propriétaire du jeu : prix fixe, pas d'historique de prix candidat
-- à conserver puisque ce n'est plus ce qui est payé).
ALTER TABLE "tender_application" DROP COLUMN "proposedPrice";
