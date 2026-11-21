import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { sendContact, type ContactTopic } from '../api/endpoints';
import TopicSelect from './TopicSelect';

const TOPICS: ContactTopic[] = ['board', 'plots', 'partner', 'game', 'other'];
const KNOWN_ERRORS = ['invalid_whatsapp', 'contact_busy', 'too_many_requests', 'network_error'];

/**
 * Formulaire de contact du site (pages Contact et Annonces) : le message est enregistré dans l'administration
 * et envoyé par e-mail à l'équipe. WhatsApp obligatoire (c'est par là qu'on répond d'abord), e-mail facultatif.
 */
export default function ContactForm({ topic: initialTopic = 'other' }: { topic?: ContactTopic }) {
  const { t, i18n } = useTranslation();
  const [f, setF] = useState({ name: '', company: '', whatsapp: '', email: '', topic: initialTopic, message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendContact({
        name: f.name,
        company: f.company.trim() || undefined,
        whatsapp: f.whatsapp,
        email: f.email.trim() || undefined,
        topic: f.topic,
        message: f.message,
        locale: i18n.language === 'en' ? 'en' : 'fr',
        website: f.website || undefined,
      });
      setSent(true);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network_error';
      setError(KNOWN_ERRORS.includes(code) ? t(`errors.${code}`) : t('contact.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="site-form site-form-done" role="status">
        <span className="site-form-check" aria-hidden="true">✓</span>
        <strong>{t('contact.sentTitle')}</strong>
        <p>{t('contact.sentText')}</p>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setSent(false);
            setF({ ...f, message: '' });
          }}
        >
          {t('contact.again')}
        </button>
      </div>
    );
  }

  return (
    <form className="site-form" onSubmit={submit}>
      <div className="site-form-row">
        <label>
          <span>{t('contact.name')} *</span>
          <input value={f.name} onChange={set('name')} required minLength={2} maxLength={80} autoComplete="name" />
        </label>
        <label>
          <span>{t('contact.company')}</span>
          <input value={f.company} onChange={set('company')} maxLength={80} autoComplete="organization" />
        </label>
      </div>
      <div className="site-form-row">
        <label>
          <span>{t('contact.whatsapp')} *</span>
          <input type="tel" inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} required pattern="\+?[\d\s().\-]{8,24}" placeholder="+228 90 00 00 00" autoComplete="tel" />
          <small>{t('contact.whatsappHint')}</small>
        </label>
        <label>
          <span>{t('contact.email')}</span>
          <input type="email" value={f.email} onChange={set('email')} maxLength={120} autoComplete="email" />
          <small>{t('contact.emailHint')}</small>
        </label>
      </div>
      <div className="site-form-field">
        <span>{t('contact.topic')} *</span>
        <TopicSelect value={f.topic} options={TOPICS} label={t('contact.topic')} onChange={(topic) => setF({ ...f, topic })} />
      </div>
      <label>
        <span>{t('contact.message')} *</span>
        <textarea value={f.message} onChange={set('message')} required minLength={10} maxLength={2000} rows={5} />
      </label>
      {/* Piège à robots : invisible pour les visiteurs */}
      <label className="site-form-trap" aria-hidden="true">
        <span>Website</span>
        <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
      </label>
      {error && (
        <p className="site-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary big" disabled={busy}>
        {busy ? t('contact.sending') : t('contact.send')}
      </button>
      <small className="site-form-privacy">{t('contact.privacy')}</small>
    </form>
  );
}
