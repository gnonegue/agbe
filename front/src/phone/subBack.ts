import { useEffect, useRef } from 'react';

// Retour « en profondeur » : une appli qui affiche un sous-écran (fiche d'une action…) déclare comment en revenir.
// La flèche « ‹ » du téléphone et le bouton retour du navigateur ramènent alors au niveau précédent de l'appli
// au lieu de la quitter d'un coup.
let handler: (() => void) | null = null;

/** Revient au niveau précédent de l'appli ouverte si elle en a un ; sinon renvoie false. */
export function subBack(): boolean {
  if (!handler) return false;
  handler();
  return true;
}

/** Déclare le retour du sous-écran affiché (`null` quand l'appli est à son premier niveau). */
export function useSubBack(fn: (() => void) | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  const on = fn !== null;
  useEffect(() => {
    if (!on) return;
    const h = () => ref.current?.();
    handler = h;
    return () => {
      if (handler === h) handler = null;
    };
  }, [on]);
}
