import { useEffect, useRef } from 'react';

/**
 * Pages du site (accueil, comment jouer, annonces, contact, conditions) : titres, cartes et articles apparaissent quand ils
 * entrent à l'écran. Sans script (page pré-rendue) ou avec « réduire les animations », tout reste visible : la classe qui
 * masque n'est posée que si l'animation tourne. À poser sur l'élément racine de la page (ref retournée).
 */
export function useSiteReveal<T extends HTMLElement = HTMLDivElement>() {
  const page = useRef<T>(null);
  useEffect(() => {
    const root = page.current;
    if (!root || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = [
      ...root.querySelectorAll<HTMLElement>(
        'main section h2, .landing-cards > li, .howto-steps > li, .howto-goals > li, .terms-article, .landing-public-icon, .landing-music-text, .landing-final .landing-wrap > *, main section .card, main section article',
      ),
    ].filter((el, i, all) => !el.closest('.landing-hero') && all.indexOf(el) === i && !all.some((o) => o !== el && o.contains(el)));
    items.forEach((el) => {
      const list = el.parentElement;
      const i = el.matches('li') && list ? [...list.children].indexOf(el) : 0;
      el.style.setProperty('--reveal-delay', `${Math.min(i, 6) * 70}ms`);
      el.classList.add('reveal');
    });
    root.classList.add('landing-anim');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    items.forEach((el) => io.observe(el));
    // Filet de sécurité : rien ne reste caché si l'observateur ne se déclenche pas (onglet en arrière-plan, capture…)
    const safety = window.setTimeout(() => items.forEach((el) => el.classList.add('in')), 4000);
    return () => {
      io.disconnect();
      window.clearTimeout(safety);
    };
  }, []);
  return page;
}
