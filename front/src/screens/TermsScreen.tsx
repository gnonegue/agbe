import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdOffer } from '../api/endpoints';
import type { Locale } from '../api/types';
import { changeLang } from '../i18n';
import { LEGAL } from '../lib/legal';
import { TERMS } from '../lib/pages';
import SiteFooter from '../ui/SiteFooter';
import SiteNav from '../ui/SiteNav';
import { useSiteReveal } from '../lib/useSiteReveal';

// Sections des conditions, dans l'ordre ; « publisher » affiche en plus l'adresse e-mail de contact
const SECTIONS = ['object', 'publisher', 'access', 'money', 'conduct', 'info', 'ads', 'data', 'changes', 'law'] as const;

/** Page publique « Conditions d'utilisation et confidentialité », acceptée à l'inscription. */
export default function TermsScreen() {
  const page = useSiteReveal();
  const { t, i18n } = useTranslation();
  const lang: Locale = i18n.language === 'en' ? 'en' : 'fr';
  const switchLang = (l: Locale) => {
    changeLang(l);
    window.history.replaceState(null, '', TERMS[l]);
  };
  // Contact de l'éditeur : l'adresse du réglage partners.contact
  const [email, setEmail] = useState('');
  useEffect(() => {
    void getAdOffer().then((o) => setEmail(o.contact.email), () => undefined);
  }, []);
  const updated = new Date(`${LEGAL.updated}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="screen landing terms" ref={page}>
      <SiteNav current="terms" onLang={switchLang} />
      <main>
        <section className="landing-hero howto-hero">
          <div className="landing-wrap">
            <div className="landing-hero-text">
              <span className="landing-kicker">{t('terms.kicker')}</span>
              <h1>{t('terms.title')}</h1>
              <p className="landing-lead">{t('terms.intro')}</p>
              <small className="landing-free">{t('terms.updated', { date: updated })}</small>
            </div>
          </div>
        </section>
        <section className="landing-section terms-body">
          <div className="landing-wrap">
            {SECTIONS.map((k, i) => (
              <article key={k} className="terms-article">
                <h2>
                  {i + 1}. {t(`terms.sections.${k}.title`)}
                </h2>
                {t(`terms.sections.${k}.text`, { law: LEGAL.lawCountry[lang] })
                  .split('\n\n')
                  .map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                {k === 'publisher' && (
                  <p className="terms-contact">
                    {email ? <a href={`mailto:${email}`}>{email}</a> : t('terms.fields.contactHint')}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
