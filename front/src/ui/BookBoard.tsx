import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { bookBillboard, getBoardSlots, uploadPlotImage } from '../api/endpoints';
import type { Locale } from '../api/types';
import { prepareAdImage } from '../lib/image';
import { fcfa } from '../lib/format';
import { safeRedirectUrl } from '../lib/urlParams';
import { useGame } from '../phone/ctx';
import AccountGate from './AccountGate';

/**
 * Réservation d'une annonce sur les panneaux (libre-service) : annonce + paiement réel, puis validation par l'équipe.
 * Par défaut rotative (tous les panneaux sans annonce fixe) ; fixe sur le panneau `panel`, avec majoration, si celui-ci est libre.
 */
export default function BookBoard({ panel, lock, site, startOpen = false, onCancel }: { /** Panneau touché ou choisi (null : aucun, donc rotatif seulement). */ panel: number | null; /** Impose le type et masque le choix (page du site : le type est choisi avant). */ lock?: 'rotating' | 'fixed'; /** Réservation depuis le site : retour sur la page Annonces après paiement. */ site?: Locale; startOpen?: boolean; /** Annuler : par défaut, referme le formulaire sur le bouton « Réserver ». */ onCancel?: () => void }) {
  const { t } = useTranslation();
  const { catalog, run, busy, toast } = useGame();
  const [open, setOpen] = useState(startOpen);
  const [f, setF] = useState({ advertiser: '', title: '', subtitle: '', bg: '#0a7d4f', fg: '#ffffff', url: '' });
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [kind, setKind] = useState<'rotating' | 'fixed'>(lock ?? 'rotating');
  const [slots, setSlots] = useState<Awaited<ReturnType<typeof getBoardSlots>> | null>(null);
  useEffect(() => {
    let off = false;
    void getBoardSlots().then((r) => !off && setSlots(r)).catch(() => undefined);
    return () => {
      off = true;
    };
  }, []);
  const rotP = catalog?.board ?? null;
  const fixP = catalog?.boardFixed ?? null;
  // Fixe : panneau libre et hors de ceux gardés pour la rotation ; rotatif : tant que le plafond d'annonces n'est pas atteint
  const fixedOk = !!fixP && panel !== null && (!slots || (!slots.taken.includes(panel) && panel < slots.rotationFrom));
  const rotatingOk = !!rotP && (!slots || slots.rotating < slots.rotatingMax);
  const effective = lock ?? (kind === 'fixed' && fixedOk ? 'fixed' : rotatingOk ? 'rotating' : fixedOk ? 'fixed' : 'rotating');
  const product = effective === 'fixed' ? fixP : rotP;
  if (!rotP) return null;
  if (!product) return null;

  async function pickImage(file: File | undefined) {
    setError(null);
    if (!file) return;
    try {
      const blob = await prepareAdImage(file);
      setImage(blob);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      setError(t(`errors.${(e as Error).message === 'image_too_large' ? 'image_too_large' : 'invalid_image'}`));
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (f.advertiser.trim().length < 2 || f.title.trim().length < 2) return setError(t('book.required'));
    if (f.url && !/^https:\/\//i.test(f.url.trim())) return setError(t('errors.invalid_url'));
    const r = await run(() => bookBillboard({ slot: effective === 'fixed' ? panel ?? -1 : -1, ...f, url: f.url.trim() || undefined, site }));
    if (!r) return;
    if (image && !(await run(() => uploadPlotImage(r.campaignId, image)))) return;
    const url = safeRedirectUrl(r.redirectUrl);
    if (!url) return toast(t('shop.badRedirect'), 'error');
    window.location.assign(url);
  }

  if (!open) {
    return (
      <button className="btn big" onClick={() => setOpen(true)}>
        ➕ {t('book.cta', { price: fcfa(rotP.priceAmount) })}
      </button>
    );
  }
  return (
    <form className="panel book" onSubmit={submit} noValidate>
      <strong>{t('book.title')}</strong>
      {!lock && fixP && panel !== null && (
        <fieldset className="field book-kind">
          <legend>{t('book.kind')}</legend>
          <label>
            <input type="radio" name="kind" checked={effective === 'rotating'} disabled={!rotatingOk} onChange={() => setKind('rotating')} /> {t('book.kindRotating', { price: fcfa(rotP.priceAmount) })}
            <small className="muted"> {rotatingOk ? t('book.kindRotatingHelp') : t('book.kindRotatingFull')}</small>
          </label>
          <label>
            <input type="radio" name="kind" checked={effective === 'fixed'} disabled={!fixedOk} onChange={() => setKind('fixed')} /> {t('book.kindFixed', { n: panel + 1, price: fcfa(fixP.priceAmount) })}
            <small className="muted"> {fixedOk ? t('book.kindFixedHelp') : t('book.kindFixedNo')}</small>
          </label>
        </fieldset>
      )}
      {effective === 'rotating' && !rotatingOk && <p className="error" role="alert">{t('errors.rotation_full')}</p>}
      <small className="muted">{t(effective === 'fixed' ? 'book.howFixed' : 'book.howRotating', { price: fcfa(product.priceAmount) })}</small>
      <label className="field">
        <span>{t('book.advertiser')}</span>
        <input value={f.advertiser} onChange={(e) => setF({ ...f, advertiser: e.target.value })} maxLength={64} />
      </label>
      <label className="field">
        <span>{t('book.adTitle')}</span>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={40} />
      </label>
      <label className="field">
        <span>{t('book.adSubtitle')}</span>
        <input value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} maxLength={80} />
      </label>
      <div className="row-between">
        <label className="field inline-color">
          <span>{t('admin.f.bg')}</span>
          <input type="color" value={f.bg} onChange={(e) => setF({ ...f, bg: e.target.value })} />
        </label>
        <label className="field inline-color">
          <span>{t('admin.f.fg')}</span>
          <input type="color" value={f.fg} onChange={(e) => setF({ ...f, fg: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>{t('book.link')}</span>
        <input type="url" inputMode="url" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} maxLength={200} />
      </label>
      <label className="field">
        <span>{t('plots.image')}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pickImage(e.target.files?.[0])} />
        <small className="muted">{t('plots.imageHelp')}</small>
      </label>
      {preview ? (
        <img className="ad-image-preview" src={preview} alt={f.title || t('book.adTitle')} style={{ aspectRatio: '2 / 1' }} />
      ) : (
        <div className="ad-preview" style={{ background: f.bg, color: f.fg }}>
          <strong>{f.title || t('book.adTitle')}</strong>
          <span>{f.subtitle}</span>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <AccountGate><button className="btn primary big" disabled={busy || (effective === 'rotating' && !rotatingOk)}>{t('book.pay', { price: fcfa(product.priceAmount) })}</button></AccountGate>
      <button type="button" className="btn ghost" onClick={() => (onCancel ? onCancel() : setOpen(false))}>{t('app.cancel')}</button>
    </form>
  );
}
