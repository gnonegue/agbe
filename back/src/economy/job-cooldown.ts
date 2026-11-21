import type { Prisma } from '@prisma/client';

/** Date (ms) de la dernière séance d'un métier, d'après la carte { idMétier: ISO } du personnage. */
export function jobLastWorked(map: Prisma.JsonValue, jobId: string): number | null {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const v = (map as Record<string, unknown>)[jobId];
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Carte mise à jour avec la séance de `jobId` à `at` (les autres métiers gardent leur propre délai). */
export function markJobWorked(map: Prisma.JsonValue, jobId: string, at: number): Prisma.InputJsonObject {
  const base = map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, string>) : {};
  return { ...base, [jobId]: new Date(at).toISOString() };
}
