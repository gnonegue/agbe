import { GAME_DAYS_PER_MONTH } from './clock';
import { applyRate } from './money';

export const HOUSING_LADDER = ['ENTRER_COUCHER', 'CHAMBRE_SALON', 'VILLA'] as const;
export type Housing = (typeof HOUSING_LADDER)[number];

/** Mois de loyer en retard (tout mois entamé compte). */
export function overdueMonths(paidUntilGameDay: number, today: number): number {
  return today > paidUntilGameDay ? Math.ceil((today - paidUntilGameDay) / GAME_DAYS_PER_MONTH) : 0;
}

/** Jours de retard depuis l'échéance (0 si à jour). */
export function overdueDays(paidUntilGameDay: number, today: number): number {
  return Math.max(0, today - paidUntilGameDay);
}

/** Somme majorée de la pénalité pour chaque jour de retard (taux plafonné pour rester un calcul sûr). */
export function withLateFee(amount: bigint, daysLate: number, feeBpPerDay: number): bigint {
  return amount + applyRate(amount, Math.min(1_000_000, feeBpPerDay * Math.max(0, daysLate)));
}

/** Prochain versement : le plus ancien mois dû, majoré de la pénalité pour chaque jour de retard. */
export function nextRentPayment(monthly: bigint, paidUntilGameDay: number, today: number, feeBpPerDay: number): bigint {
  return withLateFee(monthly, overdueDays(paidUntilGameDay, today), feeBpPerDay);
}

/** Total des arriérés : chaque mois dû est majoré selon ses propres jours de retard. */
export function arrearsTotal(monthly: bigint, paidUntilGameDay: number, today: number, feeBpPerDay: number): bigint {
  let total = 0n;
  const months = overdueMonths(paidUntilGameDay, today);
  for (let k = 0; k < months; k++) total += withLateFee(monthly, today - (paidUntilGameDay + k * GAME_DAYS_PER_MONTH), feeBpPerDay);
  return total;
}

/** Logement inférieur après expulsion ; null = à la rue. */
export function downgrade(h: string): Housing | null {
  const i = HOUSING_LADDER.indexOf(h as Housing);
  return i > 0 ? HOUSING_LADDER[i - 1] : null;
}
