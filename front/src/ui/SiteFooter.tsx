import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '../api/types';
import { ADS, CONTACT, HOME, HOWTO, TERMS } from '../lib/pages';

/** Pied de page commun des pages publiques : contenu propre à la page (facultatif), liens, mentions. */
export default function SiteFooter({ children }: { children?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang: Locale = i18n.language === 'en' ? 'en' : 'fr';
  return (
    <footer className="landing-foot">
      <div className="landing-wrap">
        {children}
        <nav className="landing-foot-links" aria-label={t('landing.nav.footer')}>
          <a href={HOWTO[lang]}>{t('landing.howto')}</a>
          <a href={`${HOME[lang]}#inspirations`}>{t('landing.inspire.title')}</a>
          <a href={ADS[lang]}>{t('siteAds.nav')}</a>
          <a href={CONTACT[lang]}>{t('contact.nav')}</a>
          <a href={TERMS[lang]}>{t('terms.link')}</a>
        </nav>
        <small>
          © {new Date().getFullYear()} {t('app.name')} · {t('app.tagline')}
        </small>
        <small className="landing-osm">{t('map.attribution')}</small>
      </div>
    </footer>
  );
}
