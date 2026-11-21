import { useMemo, useRef, useState, type FormEvent } from 'react';
import { drawAdArt } from '../game/World';
import { useTranslation } from 'react-i18next';
import { bookPlots, uploadPlotImage, type SeaGrid, type SeaPlot } from '../api/endpoints';
import type { Locale } from '../api/types';
import { prepareAdImage } from '../lib/image';
import { fcfa } from '../lib/format';
import { safeRedirectUrl } from '../lib/urlParams';
import { useGame } from '../phone/ctx';
import AccountGate from './AccountGate';

/** Location de parcelles en mer : taille depuis la case touchée, affiche, paiement réel puis validation par l'équipe. */
const CELL_PX = 14;
const PRESETS: [number, number][] = [[1, 1], [2, 2], [3, 2], [4, 3], [6, 3], [6, 6]];
const SWATCHES = ['#0a7d4f', '#d21034', '#22a861', '#f18f01', '#ffce00', '#14213d', '#8e44ad', '#ffffff'];

export default function BookPlot({ zone, grid, price, periodDays, periods: periodOptions, plots, x: x0, y: y0, onClose, site }: { zone: string; grid: SeaGrid; price: number; periodDays: number; periods: number[]; plots: SeaPlot[]; x: number; y: number; onClose: () => void; /** Réservation depuis le site : retour sur la page Annonces après paiement. */ site?: Locale }) {
  const { t } = useTranslation();
  const { run, busy, toast } = useGame();
  // Emplacement choisi sur la mini-carte (le serveur revérifie tout)
  const [x, setX] = useState(x0);
  const [y, setY] = useState(y0);
  const maxW = Math.min(grid.maxSide, grid.cols - x);
  const maxH = Math.min(grid.maxSide, grid.rows - y);
  const [w0, setW] = useState(2);
  const [h0, setH] = useState(2);
  const w = Math.max(1, Math.min(w0, maxW));
  const h = Math.max(1, Math.min(h0, maxH));
  const clash = plots.some((p) => x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h);
  const [f, setF] = useState({ advertiser: '', title: '', subtitle: '', bg: '#0a7d4f', fg: '#ffffff', url: '' });
  const [error, setError] = useState<string | null>(null);
  // Image de l'annonce, préparée sur l'appareil (redimensionnée, sans métadonnées) ; aperçu local
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
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
  // Durée en semaines (prix par case et par semaine, fixé par le serveur)
  const [periods, setPeriods] = useState(periodOptions[0] ?? 1);
  const days = periods * periodDays;
  const total = price * w * h * periods;
  const fileRef = useRef<HTMLInputElement>(null);
  // Aperçu identique à l'affiche dessinée dans la ville (tant qu'aucune image n'est choisie)
  const art = useMemo(
    () => (preview ? null : drawAdArt(f.title || t('book.adTitle'), f.subtitle, f.bg, f.fg, w, h).toDataURL('image/png')),
    [preview, f.title, f.subtitle, f.bg, f.fg, w, h, t],
  );
  const swatches = (key: 'bg' | 'fg') => (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button key={c} type="button" className={`swatch${f[key] === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, [key]: c })} aria-label={c} />
      ))}
      <input type="color" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} aria-label={t(key === 'bg' ? 'admin.f.bg' : 'admin.f.fg')} />
    </div>
  );

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (f.advertiser.trim().length < 2 || f.title.trim().length < 2) return setError(t('book.required'));
    if (clash) return setError(t('errors.plot_taken'));
    if (f.url && !/^https:\/\//i.test(f.url.trim())) return setError(t('errors.invalid_url'));
    const r = await run(() => bookPlots({ zone, x, y, w, h, periods, ...f, url: f.url.trim() || undefined, site }));
    if (!r) return;
    if (image && !(await run(() => uploadPlotImage(r.campaignId, image)))) return;
    const url = safeRedirectUrl(r.redirectUrl);
    if (!url) return toast(t('shop.badRedirect'), 'error');
    window.location.assign(url);
  }

  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="venue-card book" onSubmit={submit} noValidate role="dialog" aria-modal="true" aria-label={t('plots.title')}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="venue-head">
          <span className="venue-emoji" aria-hidden="true">{zone === 'sea' ? '🌊' : zone.startsWith('lac') ? '🛶' : '📢'}</span>
          <div>
            <h2>{t(`plots.zoneTitle.${zone}`, { defaultValue: t('plots.title') })}</h2>
            <small>{t('plots.where', { x: x + 1, y: y + 1, days })}</small>
          </div>
          <button type="button" className="btn ghost small close" onClick={onClose} aria-label={t('app.close')}>✕</button>
        </header>
        <small className="muted">{t('plots.how', { price: fcfa(price), days: periodDays })}</small>
        <h3 className="book-step"><span className="step-num">1</span> {t('plots.step1')}</h3>
        <div className="book-section">
        <div className="sea-map" role="group" aria-label={t('plots.map')}>
          <div
            className="sea-map-grid"
            style={{ width: grid.cols * CELL_PX, height: grid.rows * CELL_PX, backgroundSize: `${CELL_PX}px ${CELL_PX}px` }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setX(Math.min(grid.cols - 1, Math.max(0, Math.floor((e.clientX - r.left) / CELL_PX))));
              setY(Math.min(grid.rows - 1, Math.max(0, Math.floor((e.clientY - r.top) / CELL_PX))));
            }}
          >
            {plots.map((p) => (
              <span
                key={p.id}
                className="sea-map-plot"
                style={{
                  left: p.x * CELL_PX,
                  top: p.y * CELL_PX,
                  width: p.w * CELL_PX,
                  height: p.h * CELL_PX,
                  background: p.live ? (p.hasImage ? `center / cover url(/api/boards/${p.id}/image)` : p.bg) : undefined,
                }}
              />
            ))}
            <span className={`sea-map-pick${clash ? ' bad' : ''}`} style={{ left: x * CELL_PX, top: y * CELL_PX, width: w * CELL_PX, height: h * CELL_PX }} />
          </div>
        </div>
        <div className="row-between">
          {(
            [
              ['width', w, maxW, setW],
              ['height', h, maxH, setH],
            ] as const
          ).map(([k, v, max, set]) => (
            <div key={k} className="stepper">
              <button type="button" className="btn ghost small" onClick={() => set(Math.max(1, v - 1))} disabled={v <= 1} aria-label={t('plots.less')}>−</button>
              <div>
                <strong>{v}</strong>
                <small>{t(`plots.${k}`)}</small>
              </div>
              <button type="button" className="btn ghost small" onClick={() => set(Math.min(max, v + 1))} disabled={v >= max} aria-label={t('plots.more')}>+</button>
            </div>
          ))}
        </div>
        <div className="chips-row" role="group" aria-label={t('plots.presets')}>
          {PRESETS.map(([pw, ph]) => (
            <button key={`${pw}x${ph}`} type="button" className={`look-chip${w === pw && h === ph ? ' on' : ''}`} disabled={pw > maxW || ph > maxH} onClick={() => (setW(pw), setH(ph))}>
              {pw} × {ph}
            </button>
          ))}
        </div>
        <p className={clash ? 'error' : 'ok'}>{clash ? `⛔ ${t('errors.plot_taken')}` : `✅ ${t('plots.free')}`}</p>
        </div>
        <h3 className="book-step"><span className="step-num">2</span> {t('plots.duration')}</h3>
        <div className="durations" role="group" aria-label={t('plots.duration')}>
          {periodOptions.map((wk) => (
            <button key={wk} type="button" className={`look-chip${wk === periods ? ' on' : ''}`} onClick={() => setPeriods(wk)}>
              <strong>{t('plots.days', { count: wk * periodDays })}</strong>
              <small>{fcfa(price * w * h * wk)}</small>
            </button>
          ))}
        </div>
        <h3 className="book-step"><span className="step-num">3</span> {t('plots.step2')}</h3>
        <div className={`ad-stage${zone === 'east' ? ' land' : ''}`}>
          <img src={preview ?? art ?? ''} alt={f.title || t('book.adTitle')} style={{ aspectRatio: `${w} / ${h}` }} />
          <span className="ad-stage-cap">{t('plots.previewCap', { w, h })}</span>
        </div>
        <div className="book-section">
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
        <div className="colors">
          <span>{t('admin.f.bg')}</span>
          {swatches('bg')}
          <span>{t('admin.f.fg')}</span>
          {swatches('fg')}
        </div>
        <label className="field">
          <span>{t('book.link')}</span>
          <input type="url" inputMode="url" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} maxLength={200} />
        </label>
        <div className="field">
          <span>{t('plots.image')}</span>
          <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void pickImage(e.target.files?.[0])} />
          <div className="row-between">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>📷 {preview ? t('plots.changeImage') : t('plots.addImage')}</button>
            {preview && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  URL.revokeObjectURL(preview);
                  setPreview(null);
                  setImage(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              >
                {t('plots.removeImage')}
              </button>
            )}
          </div>
          <small className="muted">{t('plots.imageHelp')}</small>
        </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="book-footer">
          <div className="row-between plot-total">
            <span>{t('plots.count', { count: w * h, days })}</span>
            <strong>{fcfa(total)}</strong>
          </div>
          <AccountGate><button className="btn primary big book-pay" disabled={busy || clash}>{t('plots.pay', { count: w * h, price: fcfa(total) })}</button></AccountGate>
        </div>
      </form>
    </div>
  );
}
