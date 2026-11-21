// Liste blanche des origines vers lesquelles le front accepte de rediriger pour un paiement.
// Seul endroit à modifier lors du choix du fournisseur.
// Ajouter l'origine du fournisseur retenu, ex. https://checkout.fedapay.com
// (origine exacte : schéma https + hôte [+ port], sans chemin ni barre finale).
export const PAYMENT_ORIGINS: readonly string[] = [];
