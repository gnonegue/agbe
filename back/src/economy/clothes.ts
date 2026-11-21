// Habillement (fonctions pures) : composition d'une tenue, prix des boutiques de vêtements. Argent en FCFA (entiers).
import { applyRate } from './money';

export const SLOTS = ['top', 'bottom', 'dress', 'shoes'] as const;
export type Slot = (typeof SLOTS)[number];
/** Coupes reconnues par le rendu 3D, par emplacement. */
export const STYLES: Record<Slot, readonly string[]> = {
  top: ['tshirt', 'polo', 'shirt', 'blouse', 'tunic', 'jacket'],
  bottom: ['jeans', 'trousers', 'shorts', 'skirt', 'pagne'],
  dress: ['dress', 'gown'],
  shoes: ['sneakers', 'sandals', 'dress_shoes', 'heels'],
};

export interface GarmentLike {
  id: string;
  slot: Slot;
  /** m : homme, f : femme, u : les deux. */
  gender: 'm' | 'f' | 'u';
  price: number;
}

/** Tenue portée : le haut et le bas, ou une robe ; chaussures facultatives (sinon celles d'origine). */
export interface Outfit {
  top?: string;
  bottom?: string;
  dress?: string;
  shoes?: string;
}

/** Un vêtement convient-il à ce personnage (coupe homme, femme ou mixte) ? */
export function fits(g: Pick<GarmentLike, 'gender'>, female: boolean): boolean {
  return g.gender === 'u' || g.gender === (female ? 'f' : 'm');
}

/**
 * Code d'erreur si la tenue n'est pas portable, sinon null : chaque pièce existe, est possédée, va à son emplacement
 * et convient au personnage ; une robe remplace le haut et le bas, sinon les deux sont exigés.
 */
export function outfitError(outfit: Outfit, catalog: GarmentLike[], owned: ReadonlySet<string>, female: boolean): string | null {
  for (const slot of SLOTS) {
    const id = outfit[slot];
    if (id === undefined) continue;
    const g = catalog.find((x) => x.id === id);
    if (!g) return 'unknown_garment';
    if (g.slot !== slot) return 'wrong_slot';
    if (!owned.has(id)) return 'garment_not_owned';
    if (!fits(g, female)) return 'garment_wrong_gender';
  }
  if (outfit.dress) return outfit.top || outfit.bottom ? 'dress_with_separates' : null;
  if (!outfit.top || !outfit.bottom) return 'outfit_incomplete';
  return null;
}

/** Boutique d'un joueur : prix de gros payé pour garnir le stock, et bornes du prix de vente qu'il fixe. */
export function shopPrices(retail: number, wholesaleBp: number, maxPriceBp: number): { wholesale: number; min: number; max: number } {
  const wholesale = Math.max(1, Number(applyRate(BigInt(retail), wholesaleBp)));
  return { wholesale, min: wholesale, max: Math.max(wholesale, Number(applyRate(BigInt(retail), maxPriceBp))) };
}

/**
 * Fermeture d'une boutique : le fournisseur rachète le stock invendu (part du prix de gros) et le loyer payé d'avance mais
 * non consommé est remboursé en partie. Entiers FCFA.
 */
export function closeQuote(stock: { qty: number; wholesale: number }[], daysLeft: number, weeklyRent: number, buybackBp: number, refundBp: number): { buyback: bigint; refund: bigint } {
  const stockValue = stock.reduce((a, l) => a + BigInt(l.qty) * BigInt(l.wholesale), 0n);
  const unused = (BigInt(weeklyRent) * BigInt(Math.max(0, daysLeft))) / 7n;
  return { buyback: applyRate(stockValue, buybackBp), refund: applyRate(unused, refundBp) };
}

/**
 * Appétit des clients du quartier pour un article selon son prix de vente : fort au prix de gros, moyen au prix public,
 * nul à partir de 140 % du prix public (points de base, 0 à 10 000).
 */
export function npcDemandBp(price: number, retail: number): number {
  if (retail <= 0) return 0;
  const ratioBp = Math.round((price * 10_000) / retail);
  return Math.max(0, Math.min(10_000, 14_000 - ratioBp));
}
