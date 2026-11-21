import { randomInt } from 'node:crypto';

export type Condition = 'RICH' | 'MIDDLE' | 'POOR';

/** Tirage pondéré « Laisser le destin décider ». Côté serveur uniquement, avec un aléa cryptographique. */
export function drawCondition(
  weights: Record<Condition, number>,
  rng: (max: number) => number = randomInt,
): Condition {
  const order: Condition[] = ['POOR', 'MIDDLE', 'RICH'];
  const total = order.reduce((s, k) => s + Math.max(0, Math.floor(weights[k] ?? 0)), 0);
  if (total <= 0) throw new RangeError('destiny weights must sum to > 0');
  let roll = rng(total);
  for (const k of order) {
    const w = Math.max(0, Math.floor(weights[k] ?? 0));
    if (roll < w) return k;
    roll -= w;
  }
  return 'POOR';
}

/** Plafond de places par condition de départ choisie : part maximale des personnages existants, avec un plancher de places. */
export interface ConditionQuota {
  /** Part maximale des personnages (points de base, 10 000 = 100 %). */
  maxShareBp: number;
  /** Nombre de places toujours ouvertes, pour qu'un jeu qui démarre ne soit pas bloqué faute d'effectif. */
  minSlots: number;
}
export type ConditionCounts = Record<Condition, number>;
export type ConditionAvailability = Record<Condition, boolean>;

/**
 * Quelles conditions de départ restent choisissables ? La pauvre l'est toujours. Pour une autre condition, la place
 * n'est ouverte que si, une fois le nouveau personnage compté, sa part ne dépasse pas le plafond (arrondi inférieur),
 * ou si le plancher de places n'est pas atteint. Calcul en entiers uniquement.
 */
export function conditionAvailability(counts: ConditionCounts, quota: { RICH: ConditionQuota; MIDDLE: ConditionQuota }): ConditionAvailability {
  const total = counts.RICH + counts.MIDDLE + counts.POOR;
  const open = (c: 'RICH' | 'MIDDLE') => {
    const q = quota[c];
    const cap = Math.max(q.minSlots, Math.floor(((total + 1) * q.maxShareBp) / 10_000));
    return counts[c] + 1 <= cap;
  };
  return { RICH: open('RICH'), MIDDLE: open('MIDDLE'), POOR: true };
}

/** Le tirage du destin tombe sur une condition complète : on descend d'un cran (riche → moyen → pauvre). */
export function settleDestiny(drawn: Condition, available: ConditionAvailability): Condition {
  const order: Condition[] = ['RICH', 'MIDDLE', 'POOR'];
  for (const c of order.slice(order.indexOf(drawn))) if (available[c]) return c;
  return 'POOR';
}
