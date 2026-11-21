// Tarifs de transport en ville. Fonctions pures : le serveur calcule, le client n'affiche qu'une estimation.

export type TransportMode = 'WALK' | 'ZEM' | 'WORO' | 'BUS' | 'CAR' | 'MOTO';
export const TRANSPORT_MODES: readonly TransportMode[] = ['WALK', 'ZEM', 'WORO', 'BUS'];

export interface TransportModeConfig {
  /** Prise en charge, en FCFA. */
  base: number;
  /** Prix par kilomètre, en FCFA. */
  perKm: number;
  /** Arrondi du tarif (les zémidjans ne rendent pas la monnaie sur 15 F). */
  roundTo: number;
  /** Fatigue du trajet (énergie perdue par km). */
  energyPerKm: number;
  /** Risque d'incident en points de base (1 % = 100). */
  riskBp: number;
}

/** 10 unités de la carte = 1 km. */
export const UNITS_PER_KM = 10;

/** Distance en mètres entiers entre deux points de la carte. */
export function distanceMeters(ax: number, az: number, bx: number, bz: number): number {
  return Math.round((Math.hypot(bx - ax, bz - az) * 1000) / UNITS_PER_KM);
}

/** Tarif en FCFA (entier), arrondi au multiple supérieur de `roundTo`. Gratuit à pied. */
export function fare(meters: number, cfg: TransportModeConfig): bigint {
  if (meters <= 0 || (cfg.base === 0 && cfg.perKm === 0)) return 0n;
  const raw = BigInt(cfg.base) + (BigInt(cfg.perKm) * BigInt(meters) + 999n) / 1000n;
  const step = BigInt(Math.max(1, cfg.roundTo));
  return ((raw + step - 1n) / step) * step;
}

/** Énergie perdue pendant le trajet (entier, au plus 40). */
export function travelEnergy(meters: number, cfg: TransportModeConfig): number {
  return Math.min(40, Math.ceil((meters * cfg.energyPerKm) / 1000));
}
