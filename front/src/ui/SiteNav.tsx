import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '../api/types';
import { ADS, CONTACT, HOME, HOWTO, TERMS } from '../lib/pages';
import LangSwitch from './LangSwitch';

/**
 * En-tête commun des pages publiques : logo (retour à l'accueil), menu, choix de la langue.
 * Téléphone : bouton menu qui déroule un panneau (liens, langue, « Jouer ») ; ordinateur : tout dans la barre.
 * `onStart` (accueil, guide) : le bouton « Jouer » du panneau lance la partie ; sinon il mène à l'accueil.
 */
export default function SiteNav({ current, onLang, onStart, member = false }: { current: 'home' | 'howto' | 'terms' | 'ads' | 'contact'; onLang: (l: Locale) => void; onStart?: () => void; member?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang: Locale = i18n.language === 'en' ? 'en' : 'fr';
  const [open, setOpen] = useState(false);
  const links = [
    { id: 'home', href: HOME[lang], label: t('landing.nav.home') },
    { id: 'howto', href: HOWTO[lang], label: t('landing.howto') },
    { id: 'ads', href: ADS[lang], label: t('siteAds.nav') },
    { id: 'contact', href: CONTACT[lang], label: t('contact.nav') },
    { id: 'terms', href: TERMS[lang], label: t('terms.nav') },
  ] as const;

  // Menu ouvert : Échap le ferme, la page derrière ne défile plus
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('landing-menu-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('landing-menu-open');
    };
  }, [open]);

  const play = t(member ? 'landing.resume' : 'landing.play');
  return (
    <>
      <header className={open ? 'landing-nav open' : 'landing-nav'}>
        <div className="landing-wrap">
          <a className="landing-home" href={HOME[lang]}>
            <span className="landing-mark" aria-hidden="true" />
            <span className="landing-brand">
              <span className="landing-name">{t('app.name')}</span>
              <small>{t('app.tagline')}</small>
            </span>
          </a>
          <nav className="landing-menu" aria-label={t('landing.nav.label')}>
            {links.map((l) => (
              <a key={l.id} href={l.href} aria-current={current === l.id ? 'page' : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="landing-nav-lang">
            <LangSwitch onChange={onLang} />
          </div>
          <button type="button" className="landing-burger" aria-expanded={open} aria-controls="site-menu" aria-label={t(open ? 'landing.nav.close' : 'landing.nav.open')} onClick={() => setOpen((o) => !o)}>
            <span aria-hidden="true" />
          </button>
        </div>

        <div className="landing-drawer" id="site-menu" hidden={!open}>
          <nav aria-label={t('landing.nav.label')}>
            <ul>
              {links.map((l) => (
                <li key={l.id}>
                  <a href={l.href} aria-current={current === l.id ? 'page' : undefined} onClick={() => setOpen(false)}>
                    <span>{l.label}</span>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="landing-drawer-foot">
            <div className="landing-drawer-lang">
              <small>{t('landing.nav.language')}</small>
              <LangSwitch onChange={onLang} />
            </div>
            {onStart ? (
              <button
                type="button"
                className="btn primary big"
                onClick={() => {
                  setOpen(false);
                  onStart();
                }}
              >
                {play}
              </button>
            ) : (
              <a className="btn primary big" href={HOME[lang]}>
                {play}
              </a>
            )}
          </div>
        </div>
      </header>
      {/* Voile sous la barre : un toucher en dehors du panneau le ferme */}
      <div className="landing-backdrop" hidden={!open} onClick={() => setOpen(false)} aria-hidden="true" />
    </>
  );
}
