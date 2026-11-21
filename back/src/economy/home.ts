// Aménagement du logement (fonctions pures) : emprise d'un meuble, limites de la pièce, chevauchements, standing.

export interface FurnitureDef {
  id: string;
  w: number;
  d: number;
  comfort: number;
  flat?: boolean;
}
export interface Placed {
  itemId: string;
  x: number;
  z: number;
  rot: number;
}

/** Demi-emprise au sol (selon les quarts de tour : une rotation impaire échange largeur et profondeur). */
export function halfFootprint(def: Pick<FurnitureDef, 'w' | 'd'>, rot: number): { hw: number; hd: number } {
  return rot % 2 === 0 ? { hw: def.w / 2, hd: def.d / 2 } : { hw: def.d / 2, hd: def.w / 2 };
}

/** Marge gardée entre un meuble et les murs de la pièce (mètres). */
export const WALL_MARGIN = 0.15;

/** Le meuble tient dans la pièce (dimensions totales w × d, centre à l'origine). */
export function insideRoom(def: Pick<FurnitureDef, 'w' | 'd'>, p: Pick<Placed, 'x' | 'z' | 'rot'>, room: { w: number; d: number }): boolean {
  const { hw, hd } = halfFootprint(def, p.rot);
  return Math.abs(p.x) + hw <= room.w / 2 - WALL_MARGIN && Math.abs(p.z) + hd <= room.d / 2 - WALL_MARGIN;
}

/** Deux meubles se chevauchent (les tapis, « flat », se glissent sous les autres). */
export function overlaps(a: { def: FurnitureDef; p: Placed }, b: { def: FurnitureDef; p: Placed }): boolean {
  if (a.def.flat || b.def.flat) return false;
  const A = halfFootprint(a.def, a.p.rot);
  const B = halfFootprint(b.def, b.p.rot);
  return Math.abs(a.p.x - b.p.x) < A.hw + B.hw - 1e-6 && Math.abs(a.p.z - b.p.z) < A.hd + B.hd - 1e-6;
}

export type Standing = 'MODEST' | 'COMFORTABLE' | 'LUXURIOUS';

/** Standing du logement : somme du confort des meubles posés comparée aux seuils des réglages. */
export function standingOf(comfort: number, thresholds: { comfortable: number; luxurious: number }): Standing {
  return comfort >= thresholds.luxurious ? 'LUXURIOUS' : comfort >= thresholds.comfortable ? 'COMFORTABLE' : 'MODEST';
}

/** Prix de revente (entier FCFA, arrondi à l'unité inférieure). */
export const resalePrice = (paid: number, resaleBp: number): number => Math.floor((paid * resaleBp) / 10_000);
