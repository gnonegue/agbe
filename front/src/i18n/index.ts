import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getSavedLang, saveLang } from '../lib/prefs';
import type { Locale } from '../api/types';

function browserLang(): Locale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    const base = (l || '').toLowerCase().slice(0, 2);
    if (base === 'fr' || base === 'en') return base;
  }
  return 'fr';
}

// Les pages publiques anglaises ont leur propre adresse (/en, /en/…), pour les moteurs de recherche et les liens partagés
const pathLang = (): Locale | null => (typeof window !== 'undefined' && /^\/en(\/|$)/.test(window.location.pathname) ? 'en' : null);

// Une seule langue téléchargée au démarrage (≈ 60 Ko compressés chacune) : l'autre ne l'est que si le joueur en change.
// En 3G, c'est autant de secondes gagnées avant le premier écran.
const loaders: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  fr: () => import('./fr.json'),
  en: () => import('./en.json'),
};
const loaded = new Map<Locale, Promise<void>>();

/** Charge les textes d'une langue (une seule fois). */
export function loadLang(l: Locale): Promise<void> {
  let p = loaded.get(l);
  if (!p) {
    p = loaders[l]().then((m) => {
      i18n.addResourceBundle(l, 'translation', m.default, true, true);
    });
    loaded.set(l, p);
    p.catch(() => loaded.delete(l)); // réseau coupé : on réessaiera
  }
  return p;
}

const initial: Locale = pathLang() ?? (typeof window !== 'undefined' ? getSavedLang() ?? browserLang() : 'fr');

/** Prêt quand les textes de la langue de départ sont chargés : l'appli attend cette promesse avant son premier rendu. */
export const i18nReady: Promise<void> = i18n
  .use(initReactI18next)
  .init({
    resources: {},
    partialBundledLanguages: true,
    lng: initial,
    fallbackLng: 'fr',
    supportedLngs: ['fr', 'en'],
    interpolation: { escapeValue: false }, // React échappe déjà
    returnNull: false,
    showSupportNotice: false, // pas de message promotionnel dans la console
  })
  .then(() => loadLang(initial))
  .then(() => void i18n.changeLanguage(initial))
  .catch(() => undefined);

if (typeof document !== 'undefined') {
  document.documentElement.lang = initial;
  i18n.on('languageChanged', (l) => {
    document.documentElement.lang = l;
  });
}

export function changeLang(l: Locale): void {
  saveLang(l);
  void loadLang(l).then(() => i18n.changeLanguage(l));
}

/** Nom d'un lieu à partir de son identifiant (fourni par l'écran de jeu quand la carte est chargée). */
let placeName: (id: string) => string | undefined = () => undefined;
export function setPlaceNames(fn: (id: string) => string | undefined): void {
  placeName = fn;
}

/**
 * Traduit un code d'erreur API en message clair pour le joueur. Les codes « il faut être à tel endroit » (`go_to_…`,
 * `work_at_…`, `buy_at_…`, `sell_at_…`) sans texte propre donnent le nom du lieu ; un code inconnu est affiché tel quel,
 * pour que le joueur puisse le signaler.
 */
export function errorText(code: string): string {
  const key = `errors.${code}`;
  if (i18n.exists(key)) return i18n.t(key);
  const at = /^(?:go_to|work_at|buy_at|sell_at)_([a-z0-9_]+)$/.exec(code);
  if (at) {
    const id = at[1]!;
    const fallback = id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    return i18n.t('errors.atPlace', { place: placeName(id) ?? fallback });
  }
  return /^[a-z0-9_]{2,64}$/.test(code) ? i18n.t('errors.unknownCode', { code }) : i18n.t('errors.unknown');
}

export default i18n;
