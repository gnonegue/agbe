// Règles de la tontine (fonctions pures). Argent en BigInt (FCFA), jours de jeu entiers.

/** Tour en cours au jour `day` (peut dépasser le dernier tour : la tontine est alors à solder). */
export function roundAt(startDay: number, periodDays: number, day: number): number {
  if (periodDays <= 0) throw new RangeError('periodDays must be > 0');
  return day < startDay ? 0 : Math.floor((day - startDay) / periodDays);
}

/** Premier jour de jeu où le tour `round` est échu (cotisations closes, caisse à verser). */
export function deadlineOf(startDay: number, periodDays: number, round: number): number {
  return startDay + (round + 1) * periodDays;
}

/** Ordre de ramassage tiré au sort (Fisher-Yates) avec un générateur d'entiers fourni (crypto côté serveur). */
export function drawTurns<T>(items: readonly T[], randInt: (maxExclusive: number) => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface RoundSettlement {
  /** Montant total cotisé pour ce tour. */
  pot: bigint;
  /** Membres qui n'ont pas cotisé ce tour (défaillants). */
  missing: string[];
  /** Versement : au bénéficiaire, ou remboursement des cotisants si le bénéficiaire est défaillant ou parti. */
  payout: { kind: 'beneficiary'; to: string; amount: bigint } | { kind: 'refund'; to: { member: string; amount: bigint }[] } | { kind: 'none' };
}

/**
 * Règlement d'un tour : la caisse revient au bénéficiaire du tour, sauf s'il a manqué une cotisation
 * (dans ce tour ou avant) ou s'il a quitté le jeu : chaque cotisant est alors remboursé.
 */
export function settleRound(input: {
  members: { id: string; turn: number; missedBefore: number; present: boolean }[];
  paid: { memberId: string; amount: bigint }[];
  round: number;
}): RoundSettlement {
  const paidBy = new Map(input.paid.map((p) => [p.memberId, p.amount]));
  const pot = input.paid.reduce((s, p) => s + p.amount, 0n);
  const missing = input.members.filter((m) => !paidBy.has(m.id)).map((m) => m.id);
  if (pot === 0n) return { pot, missing, payout: { kind: 'none' } };
  const b = input.members.find((m) => m.turn === input.round);
  const eligible = b && b.present && b.missedBefore === 0 && paidBy.has(b.id);
  if (eligible) return { pot, missing, payout: { kind: 'beneficiary', to: b.id, amount: pot } };
  return { pot, missing, payout: { kind: 'refund', to: input.paid.map((p) => ({ member: p.memberId, amount: p.amount })) } };
}
