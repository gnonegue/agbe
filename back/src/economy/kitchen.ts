/** Cuisine à la maison : calculs purs (péremption, prélèvement dans les lots, coût d'une recette). */

export interface Lot {
  id: string;
  qty: number;
  /** Null : ne se périme pas. */
  expiresAt: Date | null;
}

/** Lots encore bons à `now` (non périmés). */
export function freshLots<T extends Lot>(lots: T[], now: number): T[] {
  return lots.filter((l) => l.qty > 0 && (l.expiresAt === null || l.expiresAt.getTime() > now));
}

/** Quantité totale disponible (lots bons). */
export function available(lots: Lot[], now: number): number {
  return freshLots(lots, now).reduce((a, l) => a + l.qty, 0);
}

/**
 * Prélève `need` unités en commençant par les lots qui périment le plus tôt (ceux qui ne périment jamais en dernier).
 * Renvoie la liste des prélèvements, ou null s'il n'y en a pas assez.
 */
export function takeFromLots(lots: Lot[], need: number, now: number): { id: string; take: number }[] | null {
  const order = freshLots(lots, now).sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
  const plan: { id: string; take: number }[] = [];
  let left = need;
  for (const l of order) {
    if (left <= 0) break;
    const take = Math.min(l.qty, left);
    plan.push({ id: l.id, take });
    left -= take;
  }
  return left > 0 ? null : plan;
}

/** Durée de conservation en jours de jeu : multipliée avec un réfrigérateur (`fridgeBp` en points de base). 0 jour = ne se périme pas. */
export function shelfDays(days: number, fridge: boolean, fridgeBp: number): number {
  if (days <= 0) return 0;
  return fridge ? (days * fridgeBp) / 10_000 : days;
}

/** Coût d'une préparation au prix unitaire des ingrédients (prix du lot divisé par son contenu). */
export function recipeCost(items: { qty: number }[], unitPrice: (i: number) => number): number {
  return Math.round(items.reduce((a, it, i) => a + it.qty * unitPrice(i), 0));
}
