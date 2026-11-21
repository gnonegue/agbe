// Section à montrer à l'ouverture d'une appli (ex. « factures » dans Logement) : posée par un bouton
// de notification, consommée une seule fois par l'appli qui l'utilise (choix de son onglet initial).

let pending: string | null = null;

export function focusSection(id: string | null): void {
  pending = id;
}

/** Consomme la section en attente (une seule fois) et la retourne, ou `null` s'il n'y en a pas. */
export function consumeFocusSection(): string | null {
  const id = pending;
  pending = null;
  return id;
}
