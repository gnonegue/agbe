// Entrée de pré-rendu (scripts/prerender.mjs) : les pages publiques en HTML statique, dans chaque langue.
import { renderToString } from 'react-dom/server';
import type { Locale } from './api/types';
import i18n, { i18nReady, loadLang } from './i18n';
import HowToPlayScreen from './screens/HowToPlayScreen';
import LandingScreen from './screens/LandingScreen';
import TermsScreen from './screens/TermsScreen';
import AdsScreen from './screens/AdsScreen';
import ContactScreen from './screens/ContactScreen';

export type Page = 'home' | 'howto' | 'terms' | 'ads' | 'contact';

export async function render(lang: Locale, page: Page) {
  await i18nReady;
  await loadLang(lang);
  await i18n.changeLanguage(lang);
  const start = () => undefined;
  const screen = page === 'terms' ? <TermsScreen /> : page === 'ads' ? <AdsScreen /> : page === 'contact' ? <ContactScreen /> : page === 'howto' ? <HowToPlayScreen onStart={start} /> : <LandingScreen onStart={start} />;
  return {
    html: renderToString(screen),
    t: (key: string) => i18n.t(key),
  };
}
