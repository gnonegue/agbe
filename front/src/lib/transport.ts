// Estimation du tarif affiché avant le départ. Même formule que le serveur (back/src/economy/transport.ts),
// mais c'est toujours le serveur qui calcule et débite le montant réel.
import type { TransportCfg } from '../api/types';

export const UNITS_PER_KM = 10;

export function distanceMeters(ax: number, az: number, bx: number, bz: number): number {
  return Math.round((Math.hypot(bx - ax, bz - az) * 1000) / UNITS_PER_KM);
}

export function estimateFare(meters: number, cfg: TransportCfg, factorBp = 10_000): number {
  if (meters <= 0 || (cfg.base === 0 && cfg.perKm === 0)) return 0;
  const raw = cfg.base + Math.floor((cfg.perKm * meters + 999) / 1000);
  const step = Math.max(1, cfg.roundTo);
  // Événements de la semaine (pénurie de carburant…) : même arrondi que le serveur
  return Math.floor((Math.ceil(raw / step) * step * factorBp + 5_000) / 10_000);
}
