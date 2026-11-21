// Foncier : prix du m² selon la position, quarts de lot, frais des démarches, rendement d'une exploitation.
// Fonctions pures : montants en FCFA entiers (BigInt), taux en points de base. Les distances de la carte servent
// seulement à choisir un taux (arrondi à l'entier), jamais à calculer un montant en nombre flottant.

export const QUARTERS_PER_LOT = 4;

export interface LandPriceModel {
  /** Centre de référence (le cœur de Lomé) : le prix y est maximal. */
  hubX: number;
  hubZ: number;
  /** FCFA le m² au centre, et plancher en rase campagne. */
  centerPerM2: number;
  edgePerM2: number;
  /** Distance (unités de carte) à laquelle la prime de centralité est divisée par deux. */
  halfDistance: number;
  /** Axes routiers (x ou z constant) : un terrain en bordure vaut plus. */
  roads: { axis: 'x' | 'z'; at: number }[];
  roadBonusBp: number;
  roadRange: number;
  /** Littoral (z constant) : prime décroissante jusqu'à `seaRange`. */
  seaZ: number;
  seaBonusBp: number;
  seaRange: number;
}

export interface PriceBreakdown {
  /** FCFA le m², arrondi à la dizaine. */
  perM2: bigint;
  /** Part de la prime de centralité (0..10000), puis majorations en points de base. */
  centralityBp: number;
  roadBp: number;
  seaBp: number;
}

const BP = 10_000;

/** Prix du m² en un point de la carte. `tierBp` : coefficient propre à la zone (10000 = 1). */
export function pricePerM2At(model: LandPriceModel, x: number, z: number, tierBp = BP): PriceBreakdown {
  const d = Math.hypot(x - model.hubX, z - model.hubZ);
  const h2 = model.halfDistance * model.halfDistance;
  const centralityBp = Math.floor((BP * h2) / (h2 + d * d));
  const base = BigInt(model.edgePerM2) + ((BigInt(model.centerPerM2) - BigInt(model.edgePerM2)) * BigInt(centralityBp)) / BigInt(BP);
  const nearRoad = model.roads.length === 0 ? Infinity : Math.min(...model.roads.map((r) => Math.abs((r.axis === 'x' ? x : z) - r.at)));
  const roadBp = nearRoad < model.roadRange ? Math.floor((model.roadBonusBp * (model.roadRange - nearRoad)) / model.roadRange) : 0;
  const nearSea = Math.abs(z - model.seaZ);
  const seaBp = nearSea < model.seaRange ? Math.floor((model.seaBonusBp * (model.seaRange - nearSea)) / model.seaRange) : 0;
  let price = (base * BigInt(BP + roadBp + seaBp) * BigInt(tierBp)) / BigInt(BP * BP);
  // Prix annoncés à la dizaine près, jamais en dessous de 10 FCFA
  price = ((price + 5n) / 10n) * 10n;
  if (price < 10n) price = 10n;
  return { perM2: price, centralityBp, roadBp, seaBp };
}

/** Centre d'une cellule de la zone sur la carte. */
export function cellCenter(zone: { originX: number; originZ: number; cols: number; cell: number }, index: number): { x: number; z: number } {
  return { x: zone.originX + (index % zone.cols) * zone.cell + zone.cell / 2, z: zone.originZ + Math.floor(index / zone.cols) * zone.cell + zone.cell / 2 };
}

/** Prix de `quarters` quarts de lot (m² = quarts × `quarterM2`). */
export function landPrice(perM2: bigint, quarters: number, quarterM2: number): bigint {
  return perM2 * BigInt(quarters) * BigInt(quarterM2);
}

/** Frais en points de base (arrondi à l'entier inférieur). */
export function feeBp(amount: bigint, rateBp: number): bigint {
  return (amount * BigInt(rateBp)) / BigInt(BP);
}

/** Frais d'une démarche (bornage, avis, titre) : au m², avec un minimum. */
export function stepFee(step: { feePerM2: number; minFee: number }, m2: number): bigint {
  const f = BigInt(step.feePerM2) * BigInt(m2);
  return f > BigInt(step.minFee) ? f : BigInt(step.minFee);
}

/** Revenu d'une exploitation : `yieldBp` du capital investi par jour de jeu entier écoulé, sur `lifeDays` jours au plus. */
export function accruedYield(cost: bigint, yieldBp: number, elapsedGameDays: number, lifeDays: number): bigint {
  const days = Math.max(0, Math.min(Math.floor(elapsedGameDays), lifeDays));
  return (cost * BigInt(yieldBp) * BigInt(days)) / BigInt(BP);
}

/** Nombre de bits à 1 d'un masque de quarts (0..15). */
export function quarterCount(mask: number): number {
  let n = 0;
  for (let m = mask & 0b1111; m > 0; m >>= 1) n += m & 1;
  return n;
}

export const STEP_ORDER = ['SURVEYED', 'OPINION', 'TITLED'] as const;
export type LandStatus = 'BOUGHT' | (typeof STEP_ORDER)[number];

/** Prochaine démarche à engager, ou null si le titre est délivré. */
export function nextStep(status: string): (typeof STEP_ORDER)[number] | null {
  const i = status === 'BOUGHT' ? 0 : STEP_ORDER.indexOf(status as (typeof STEP_ORDER)[number]) + 1;
  return i >= 0 && i < STEP_ORDER.length ? STEP_ORDER[i]! : null;
}

/**
 * Des quarts de lot forment-ils un seul terrain d'un tenant ? Chaque lot est découpé en 2 × 2 quarts (q % 2 : gauche/droite,
 * q / 2 : haut/bas) ; deux quarts se touchent s'ils partagent un côté, y compris d'un lot au lot voisin. Un coin ne suffit pas.
 */
export function quartersConnected(cols: number, quarters: { cell: number; q: number }[]): boolean {
  if (quarters.length === 0) return false;
  const key = (x: number, z: number) => `${x},${z}`;
  const pts = quarters.map(({ cell, q }) => ({ x: (cell % cols) * 2 + (q % 2), z: Math.floor(cell / cols) * 2 + Math.floor(q / 2) }));
  const all = new Set(pts.map((p) => key(p.x, p.z)));
  const seen = new Set<string>([key(pts[0]!.x, pts[0]!.z)]);
  const todo = [pts[0]!];
  while (todo.length > 0) {
    const p = todo.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = p.x + dx;
      const z = p.z + dz;
      // Pas de passage d'un bord de la zone à l'autre
      if (x < 0 || x >= cols * 2 || z < 0) continue;
      const k = key(x, z);
      if (all.has(k) && !seen.has(k)) {
        seen.add(k);
        todo.push({ x, z });
      }
    }
  }
  return seen.size === all.size;
}
