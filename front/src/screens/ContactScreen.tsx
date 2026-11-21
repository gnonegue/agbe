import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdOffer } from '../api/endpoints';
import type { Locale } from '../api/types';
import { changeLang } from '../i18n';
import { CONTACT } from '../lib/pages';
import ContactForm from '../ui/ContactForm';
import SiteFooter from '../ui/SiteFooter';
import SiteNav from '../ui/SiteNav';
import { useSiteReveal } from '../lib/useSiteReveal';

/** Page publique « Contact » : formulaire (enregistré dans l'administration et envoyé par e-mail à l'équipe). */
export default function ContactScreen() {
  const page = useSiteReveal();
  const { t } = useTranslation();
  const switchLang = (l: Locale) => {
    changeLang(l);
    window.history.replaceState(null, '', CONTACT[l]);
  };
  // Contacts directs de l'équipe (réglage partners.contact), en plus du formulaire
  const [contact, setContact] = useState<{ email: string; whatsapp: string } | null>(null);
  useEffect(() => {
    void getAdOffer().then((o) => setContact(o.contact), () => undefined);
  }, []);
  const whatsapp = contact?.whatsapp.replace(/\D/g, '');

  return (
    <div className="screen landing site-contact" ref={page}>
      <SiteNav current="contact" onLang={switchLang} />
      <main>
        <section className="landing-hero howto-hero">
          <div className="landing-wrap">
            <div className="landing-hero-text">
              <span className="landing-kicker">{t('contact.kicker')}</span>
              <h1>{t('contact.title')}</h1>
              <p className="landing-lead">{t('contact.intro')}</p>
            </div>
          </div>
        </section>
        <section className="landing-section">
          <div className="landing-wrap site-contact-body">
            {/* Lien « Partenariat » de la page de réservation : /contact#partner */}
            <ContactForm topic={typeof window !== 'undefined' && window.location.hash === '#partner' ? 'partner' : 'other'} />
            <aside className="site-contact-aside">
              <h2>{t('contact.directTitle')}</h2>
              <p>{t('contact.directText')}</p>
              {contact?.email && (
                <a className="site-contact-link" href={`mailto:${contact.email}`}>
                  <span aria-hidden="true">✉️</span> {contact.email}
                </a>
              )}
              {whatsapp && (
                <a className="site-contact-link" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                  <span aria-hidden="true">💬</span> WhatsApp
                </a>
              )}
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
