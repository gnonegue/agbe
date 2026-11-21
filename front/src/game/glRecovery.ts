import { useEffect, useState, type RefObject } from 'react';

/**
 * Écran 3D devenu noir sur mobile : le navigateur a retiré la carte graphique à la page (mémoire saturée, appli passée en
 * arrière-plan, autre onglet gourmand). Il la rend parfois (`webglcontextrestored`), mais sur Android souvent jamais, et
 * l'image reste noire jusqu'à un rechargement. Ce crochet surveille les canevas du conteneur et renvoie un compteur qui
 * augmente quand la scène doit être reconstruite : si rien n'est revenu 1,5 s après la perte (ou au retour sur l'appli).
 * Un canevas détaché du document (scène fermée volontairement) est ignoré.
 */
export function useGlRecovery(el: RefObject<HTMLElement | null>): number {
  const [gen, setGen] = useState(0);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let timer = 0;
    let lostCanvas: HTMLCanvasElement | null = null;
    let pending = false;
    const rebuild = () => {
      if (!lostCanvas?.isConnected) return;
      if (document.hidden) {
        pending = true;
        return;
      }
      pending = false;
      lostCanvas = null;
      setGen((g) => g + 1);
    };
    const lost = (e: Event) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      lostCanvas = e.target;
      window.clearTimeout(timer);
      timer = window.setTimeout(rebuild, 1500);
    };
    const restored = () => {
      window.clearTimeout(timer);
      lostCanvas = null;
      pending = false;
    };
    const visible = () => {
      if (!document.hidden && pending) rebuild();
    };
    // Phase de capture : ces événements ne remontent pas depuis le canevas
    node.addEventListener('webglcontextlost', lost, true);
    node.addEventListener('webglcontextrestored', restored, true);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener('webglcontextlost', lost, true);
      node.removeEventListener('webglcontextrestored', restored, true);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [el]);
  return gen;
}
