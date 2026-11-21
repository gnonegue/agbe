import type { Catalog, State, Venue } from '../api/types';
import { distanceMeters } from './transport';

/** Position du joueur : son lieu, ou son logement s'il est chez lui. */
function positionOf(catalog: Catalog, state: State): { x: number; z: number } | null {
  if (state.location === 'home') return state.housing ? catalog.homePosition[state.housing] ?? null : null;
  const v = catalog.venues.find((x) => x.id === state.location);
  return v ? { x: v.x, z: v.z } : null;
}

/**
 * Lieu le plus proche de la position du joueur parmi `ids` (hors celui où il se trouve déjà), avec la distance en km.
 * Même ville uniquement. Sert aux boutons « station-service / hôpital le plus proche ».
 */
export function nearestOf(catalog: Catalog | null, state: State, ids: string[]): { venue: Venue; km: number } | null {
  if (!catalog) return null;
  const here = positionOf(catalog, state);
  if (!here) return null;
  const city = state.city ?? 'lome';
  let best: { venue: Venue; km: number } | null = null;
  for (const v of catalog.venues) {
    if (!ids.includes(v.id) || v.id === state.location || (v.city ?? 'lome') !== city) continue;
    const km = distanceMeters(here.x, here.z, v.x, v.z) / 1000; // même échelle que la distance affichée dans la fiche du lieu
    if (!best || km < best.km) best = { venue: v, km };
  }
  return best;
}
