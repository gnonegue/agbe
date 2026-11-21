// Marché entre joueurs (fonctions pures). Argent en BigInt (FCFA), taux en points de base.
import { applyRate } from './money';

/** Bornes du prix de vente d'une marchandise : de 1 FCFA au prix de gros majoré de la marge maximale. */
export function priceBounds(wholesale: number, maxMarkupBp: number): { min: number; max: number } {
  return { min: 1, max: Number(applyRate(BigInt(wholesale), maxMarkupBp)) };
}

/** Vente : total payé par l'acheteur, taxe de marché (au Trésor) et net perçu par le vendeur. */
export function saleSplit(unitPrice: number, qty: number, taxBp: number): { total: bigint; tax: bigint; net: bigint } {
  if (!Number.isInteger(unitPrice) || unitPrice <= 0 || !Number.isInteger(qty) || qty <= 0) throw new RangeError('invalid sale');
  const total = BigInt(unitPrice) * BigInt(qty);
  const tax = applyRate(total, taxBp);
  return { total, tax, net: total - tax };
}

/** Rang du vendeur selon ses ventes cumulées (le plus haut seuil atteint) et le seuil suivant. */
export function rankOf(sales: bigint, ranks: { id: string; minSales: number }[]): { id: string; next: { id: string; minSales: number } | null } {
  const sorted = [...ranks].sort((a, b) => a.minSales - b.minSales);
  let cur = sorted[0]!;
  for (const r of sorted) if (sales >= BigInt(r.minSales)) cur = r;
  const next = sorted.find((r) => BigInt(r.minSales) > sales) ?? null;
  return { id: cur.id, next };
}
