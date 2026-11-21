import type { Prisma } from '@prisma/client';

export type LeisureKind = 'tv' | 'read';

/** Logements équipés d'une télé (le studio « entrer-coucher » n'en a pas). */
export const TV_HOUSING: readonly string[] = ['CHAMBRE_SALON', 'VILLA'];

/** Dernière séance d'un loisir (ms), lue dans `character.leisureAt` ; null si jamais ou valeur illisible. */
export function leisureLast(at: Prisma.JsonValue | null | undefined, kind: LeisureKind): number | null {
  if (!at || typeof at !== 'object' || Array.isArray(at)) return null;
  const v = (at as Record<string, unknown>)[kind];
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
