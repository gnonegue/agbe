// Parcelles en mer : rectangles de cases sur une grille (fonctions pures).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Deux rectangles de cases se chevauchent-ils ? (bords jointifs = pas de chevauchement) */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Le rectangle tient-il dans la grille, avec des côtés de 1 à maxSide cases ? */
export function fitsGrid(r: Rect, cols: number, rows: number, maxSide: number): boolean {
  return r.w >= 1 && r.h >= 1 && r.w <= maxSide && r.h <= maxSide && r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows;
}
