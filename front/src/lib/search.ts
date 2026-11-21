// Recherche dans les listes du jeu : sans tenir compte des majuscules ni des accents.

/** Texte comparable : minuscules, sans accents (« e » trouve « É », « ecole » trouve « École »). */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Vrai si la recherche `q` (vide : tout) apparaît dans l'un des textes. */
export function matches(q: string, ...texts: string[]): boolean {
  const n = fold(q.trim());
  return !n || texts.some((t) => fold(t).includes(n));
}
