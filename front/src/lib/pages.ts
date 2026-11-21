// Pages publiques (lisibles sans compte, pré-rendues pour les moteurs de recherche) : une adresse par langue.
import type { Locale } from '../api/types';

export const HOME: Record<Locale, string> = { fr: '/', en: '/en' };
export const HOWTO: Record<Locale, string> = { fr: '/comment-jouer', en: '/en/how-to-play' };
export const TERMS: Record<Locale, string> = { fr: '/conditions', en: '/en/terms' };
export const ADS: Record<Locale, string> = { fr: '/annonces', en: '/en/ads' };
export const CONTACT: Record<Locale, string> = { fr: '/contact', en: '/en/contact' };
/** Réservation d'un espace de pub depuis le site (compte requis, donc pas une page pré-rendue). */
export const BOOK: Record<Locale, string> = { fr: '/annonces/reserver', en: '/en/ads/book' };
export const wantsBook = (): boolean => [BOOK.fr, BOOK.en].includes(window.location.pathname.replace(/\/+$/, ''));

const path = () => window.location.pathname.replace(/\/+$/, '') || '/';

export type SitePage = 'home' | 'howto' | 'terms' | 'ads' | 'contact';
const ADDRESSES: Record<SitePage, Record<Locale, string>> = { home: HOME, howto: HOWTO, terms: TERMS, ads: ADS, contact: CONTACT };

/** Page publique demandée à l'ouverture (null : une autre adresse, par exemple /admin). */
export function sitePage(): SitePage | null {
  const p = path();
  for (const [page, a] of Object.entries(ADDRESSES)) if (a.fr === p || a.en === p) return page as SitePage;
  return null;
}

/** Toutes les pages publiques. */
export const isPublicPage = (): boolean => sitePage() !== null;

// Un joueur connecté peut revenir sur le site (Réglages du jeu) : indicateur de l'onglet, non sensible.
// Tant qu'il est posé, l'ouverture d'une page publique montre la page au lieu de relancer la partie.
const SITE_KEY = 'agbe.site';
export function browsingSite(): boolean {
  try {
    return window.sessionStorage.getItem(SITE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setBrowsingSite(v: boolean): void {
  try {
    if (v) window.sessionStorage.setItem(SITE_KEY, '1');
    else window.sessionStorage.removeItem(SITE_KEY);
  } catch {
    /* stockage indisponible : le joueur retourne simplement dans sa partie */
  }
}
