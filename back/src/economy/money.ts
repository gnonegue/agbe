// Règle d'or : l'argent est toujours un entier (FCFA). Les taux sont en points de base (1 % = 100 bp).

export const BP_DENOMINATOR = 10_000n;

/** Applique un taux en points de base à un montant entier, arrondi au FCFA le plus proche (demi vers le haut). */
export function applyRate(amount: bigint, rateBp: number): bigint {
  assertSafeRate(rateBp);
  if (amount < 0n) throw new RangeError('amount must be >= 0');
  return (amount * BigInt(rateBp) + BP_DENOMINATOR / 2n) / BP_DENOMINATOR;
}

export function assertSafeRate(rateBp: number): void {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 1_000_000) {
    throw new RangeError(`invalid rate (bp): ${rateBp}`);
  }
}

/** Convertit un montant entier positif en BigInt en refusant flottants, NaN et valeurs hors bornes. */
export function toAmount(value: number | bigint | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('amount must be a safe integer');
    return BigInt(value);
  }
  if (!/^-?\d{1,18}$/.test(value)) throw new RangeError('amount must be an integer string');
  return BigInt(value);
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}
