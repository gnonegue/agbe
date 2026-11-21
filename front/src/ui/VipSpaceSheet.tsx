import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { sendSpotRequest, type FreeSpot, type SpotAmount } from '../api/endpoints';

/** « 1 800 000 FCFA · ≈ 2 744 € · ≈ 3 000 $ » : euros et dollars seulement si le taux est réglé. */
function money(a: SpotAmount, lang: string): string {
  const n = (v: number) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR').format(v);
  return [`${n(a.xof)} FCFA`, a.eur != null ? `≈ ${n(a.eur)} €` : null, a.usd != null ? `≈ ${n(a.usd)} $` : null].filter(Boolean).join(' · ');
}

const KNOWN_ERRORS = ['invalid_whatsapp', 'spot_taken', 'request_pending', 'unknown_spot', 'too_many_requests', 'network_error'];

/**
 * Fiche d'un espace VIP libre (touché sur la carte) : ce que le partenaire y gagne, puis la demande. La demande est liée à
 * l'emplacement (le serveur lit ses coordonnées), refusée si l'emplacement est déjà pris, et validée par l'administration.
 */
export default function VipSpaceSheet({ spot, onClose, onRequested }: { spot: FreeSpot; onClose: () => void; onRequested?: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const name = i18n.language === 'en' ? spot.nameEn : spot.nameFr;
  const tier = spot.tier ?? 'GOLD';
  const [f, setF] = useState({ name: '', company: '', whatsapp: '', email: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(spot.requested);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendSpotRequest({ spotId: spot.id, name: f.name, company: f.company.trim() || undefined, whatsapp: f.whatsapp, email: f.email.trim() || undefined, message: f.message });
      setSent(true);
      onRequested?.(spot.id);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network_error';
      setError(KNOWN_ERRORS.includes(code) ? t(`errors.${code}`) : t('vip.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="venue-card vip-card" role="dialog" aria-modal="true" aria-label={t('vip.title')}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className={`vip-head ${tier.toLowerCase()}`}>
          <span className="vip-crown" aria-hidden="true">{tier === 'SILVER' ? '⭐' : tier === 'BRONZE' ? '🥉' : '👑'}</span>
          <div>
            <span className="vip-badge">{spot.tier ? t(`vip.name.${spot.tier}`) : t('vip.badge')}</span>
            <h2>{name}</h2>
            <small>{spot.tier ? t(`vip.tier.${spot.tier}`) : t('vip.tier.ANY')}</small>
          </div>
          <button className="btn ghost small close" onClick={onClose} aria-label={t('app.close')}>✕</button>
        </header>
        <div className="vip-price" aria-label={t('vip.price.title')}>
          <div className="vip-price-main">
            <strong>{money(spot.price.total, i18n.language)}</strong>
            <span>{t('vip.price.perPeriod', { count: spot.price.months })}</span>
          </div>
          <small>{t('vip.price.monthly', { amount: money(spot.price.monthly, i18n.language) })}</small>
          <small className="muted">{t('vip.price.note')}</small>
        </div>
        <p className="vip-lead">{t('vip.lead')}</p>
        <ul className="vip-perks">
          <li><span aria-hidden="true">🏢</span> {t('vip.perk1')}</li>
          <li><span aria-hidden="true">🪧</span> {t('vip.perk2')}</li>
          <li><span aria-hidden="true">📣</span> {t('vip.perk3')}</li>
          <li><span aria-hidden="true">🔗</span> {t('vip.perk4')}</li>
        </ul>
        {sent ? (
          <div className="site-form site-form-done" role="status">
            <span className="site-form-check" aria-hidden="true">✓</span>
            <strong>{t('vip.sentTitle')}</strong>
            <p>{t('vip.sentText')}</p>
            <button type="button" className="btn ghost" onClick={onClose}>{t('app.close')}</button>
          </div>
        ) : (
          <>
            <h3 className="vip-form-title">{t('vip.formTitle')}</h3>
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
                </label>
                <label>
                  <span>{t('contact.email')}</span>
                  <input type="email" value={f.email} onChange={set('email')} maxLength={120} autoComplete="email" />
                </label>
              </div>
              <label>
                <span>{t('vip.message')} *</span>
                <textarea value={f.message} onChange={set('message')} required minLength={10} maxLength={1000} rows={4} placeholder={t('vip.messageHint')} />
              </label>
              <p className="muted small-line">{t('vip.validation')}</p>
              {error && (
                <p className="site-form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn primary big" disabled={busy}>
                {busy ? t('contact.sending') : t('vip.send')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
