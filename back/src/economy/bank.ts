// Banque (fonctions pures) : intérêts simples en entiers, taux annuels en points de base, année de jeu de 360 jours.

export const GAME_DAYS_PER_YEAR = 360;
export const GAME_DAYS_PER_MONTH = 30;

/** Intérêts simples sur « days » jours de jeu au taux annuel « yearBp », arrondis au FCFA inférieur. */
export function simpleInterest(principal: bigint, yearBp: number, days: number): bigint {
  if (principal <= 0n || yearBp <= 0 || days <= 0) return 0n;
  return (principal * BigInt(yearBp) * BigInt(Math.floor(days))) / BigInt(10_000 * GAME_DAYS_PER_YEAR);
}

/** Dépôt à terme : échéance atteinte ? (jour de jeu courant ≥ début + durée). */
export function matured(startDay: number, termDays: number, day: number): boolean {
  return day >= startDay + termDays;
}
