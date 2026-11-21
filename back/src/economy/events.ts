// Événements économiques communs à tous les joueurs (pénurie de carburant, récolte, soudure, fêtes).
// Déterministes : le tirage dépend seulement de la semaine de jeu et de l'événement, donc identique pour tous.

export interface EconomicEvent {
  id: string;
  weeklyBp: number;
  /** Facteur sur le prix de gros par marchandise (« * » : toutes), 10 000 = inchangé. */
  wholesaleBp: Record<string, number>;
  transportBp: number;
}

/** Hachage FNV-1a 32 bits, ramené à 0..9 999. */
export function roll(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) % 10_000;
}

export const weekOf = (day: number) => Math.floor(day / 7);

/** Événements actifs pendant la semaine de jeu du jour donné. */
export function activeEvents(day: number, events: readonly EconomicEvent[]): EconomicEvent[] {
  const w = weekOf(day);
  return events.filter((e) => roll(`${w}:${e.id}`) < e.weeklyBp);
}

/** Facteur cumulé (points de base) sur le prix de gros d'une marchandise. */
export function wholesaleFactorBp(goodId: string, day: number, events: readonly EconomicEvent[]): number {
  let f = 10_000;
  for (const e of activeEvents(day, events)) {
    const k = e.wholesaleBp[goodId] ?? e.wholesaleBp['*'];
    if (k !== undefined) f = Math.round((f * k) / 10_000);
  }
  return f;
}

/** Facteur cumulé (points de base) sur le prix des transports. */
export function transportFactorBp(day: number, events: readonly EconomicEvent[]): number {
  let f = 10_000;
  for (const e of activeEvents(day, events)) f = Math.round((f * e.transportBp) / 10_000);
  return f;
}
