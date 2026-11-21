// Heures d'ouverture des lieux (fonction pure). [ouverture, fermeture] en heures de jeu ; fermeture < ouverture = ouvert la nuit.

export type Hours = [number, number];

/** Ouvert à cette heure ? [0, 24] = toujours ouvert ; [11, 2] = de 11 h à 2 h du matin. */
export function isOpen(h: Hours | undefined, hour: number): boolean {
  if (!h) return true;
  const [o, c] = h;
  if (o === c || (o === 0 && c === 24)) return true;
  return o < c ? hour >= o && hour < c : hour >= o || hour < c;
}
