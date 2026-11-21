// Prêt bancaire personnel (fonctions pures) : intérêts simples répartis en mensualités fixes, pénalité de
// retard bornée. Aucun accès réseau/DB ici — uniquement des calculs en entiers (FCFA en BigInt).
import { simpleInterest } from './bank';
import { applyRate } from './money';

/** Plafond de sécurité sur la pénalité cumulée d'une échéance (jamais plus de 50 % de majoration). */
export const LOAN_LATE_FEE_CAP_BP = 5_000;

/** Total à rembourser : capital emprunté + intérêts simples sur toute la durée du prêt. */
export function loanTotalDue(principal: bigint, rateBp: number, termDays: number): bigint {
  return principal + simpleInterest(principal, rateBp, termDays);
}

/** Mensualité fixe (arrondie au FCFA supérieur pour que la somme des mensualités couvre bien le total). */
export function loanInstallment(total: bigint, installments: number): bigint {
  if (installments <= 0) return total;
  return (total + BigInt(installments) - 1n) / BigInt(installments);
}

/** Montant à prélever à une échéance : la mensualité fixe, ou le capital restant s'il est plus petit (dernier versement). */
export function loanDueNow(remaining: bigint, installment: bigint): bigint {
  return remaining < installment ? remaining : installment;
}

/** Pénalité de retard sur un montant dû, bornée pour rester un calcul sûr. */
export function loanLatePenalty(amount: bigint, daysLate: number, feeBpPerDay: number): bigint {
  if (amount <= 0n || daysLate <= 0) return 0n;
  return applyRate(amount, Math.min(LOAN_LATE_FEE_CAP_BP, feeBpPerDay * daysLate));
}

/** Montant effectivement prélevé à une échéance en retard : montant dû majoré de la pénalité. */
export function loanAmountWithPenalty(due: bigint, daysLate: number, feeBpPerDay: number): bigint {
  return due + loanLatePenalty(due, daysLate, feeBpPerDay);
}

/**
 * Capital restant dû après un remboursement (échéance normale ou anticipé), jamais négatif.
 * Règle simple et documentée : un remboursement réduit toujours le capital restant d'exactement son montant
 * (la pénalité éventuelle est perçue séparément, elle ne réduit pas la dette). Le nombre de mensualités
 * restantes n'est jamais stocké : à chaque échéance, `loanDueNow` prélève soit la mensualité fixe, soit tout
 * le solde restant s'il est plus petit — donc moins de capital restant ⇒ moins d'échéances à venir, sans
 * recalcul explicite.
 */
export function loanRemainingAfterRepay(remaining: bigint, amount: bigint): bigint {
  const next = remaining - amount;
  return next > 0n ? next : 0n;
}
