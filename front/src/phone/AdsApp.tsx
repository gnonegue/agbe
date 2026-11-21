import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { billboardClick, getBillboards, getPlots, type Billboard, type SeaPlot } from '../api/endpoints';
import { drawAdArt } from '../game/World';

interface AdItem {
  id: string;
  title: string;
  subtitle: string;
  bg: string;
  fg: string;
  url: string | null;
  partner: string;
  image: string | null;
  where: 'board' | string;
}

/** Vitrine des publicités en ligne (panneaux de la ville, mer, est de la ville, lagunes) : on fait défiler, on ouvre le site. */
export default function AdsApp() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AdItem[] | null>(null);
  const [open, setOpen] = useState<AdItem | null>(null);
  useEffect(() => {
    const live = (zone: string, ps: SeaPlot[]): AdItem[] =>
      ps.filter((p) => p.live && p.title).map((p) => ({ id: p.id, title: p.title!, subtitle: p.subtitle ?? '', bg: p.bg ?? '#0a7d4f', fg: p.fg ?? '#ffffff', url: p.url ?? null, partner: p.partner ?? '', image: p.hasImage ? `/api/boards/${p.id}/image` : null, where: zone }));
    void Promise.all([getBillboards().catch(() => [] as Billboard[]), getPlots().catch(() => null)]).then(([boards, plots]) => {
      setItems([
        ...boards.map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, bg: b.bg, fg: b.fg, url: b.url, partner: b.partner, image: b.hasImage ? `/api/boards/${b.id}/image` : null, where: 'board' })),
        ...(plots ? live('sea', plots.plots) : []),
        ...(plots?.zones ?? []).flatMap((z) => live(z.id, z.plots)),
      ]);
    });
  }, []);
  return (
    <section>
      <h2>{t('ads.title')}</h2>
      <p className="muted">{t('ads.hint')}</p>
      {items === null && <p className="muted">{t('app.loading')}</p>}
      {items?.length === 0 && <p className="muted">{t('ads.empty')}</p>}
      {open ? (
        <AdCard a={open} full onClose={() => setOpen(null)} />
      ) : (
        <div className="ads-feed">
          {items?.map((a) => (
            <AdCard key={a.id} a={a} onOpen={() => setOpen(a)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Annonce : vignette cliquable dans le fil, ou fiche détaillée (lien vers le site s'il existe). */
function AdCard({ a, full, onOpen, onClose }: { a: AdItem; full?: boolean; onOpen?: () => void; onClose?: () => void }) {
  const { t } = useTranslation();
  const art = useMemo(() => (a.image ? null : drawAdArt(a.title, a.subtitle, a.bg, a.fg, 2, 1).toDataURL('image/png')), [a]);
  const host = (() => {
    try {
      return a.url && /^https?:\/\//i.test(a.url) ? new URL(a.url).host : null;
    } catch {
      return null;
    }
  })();
  if (!full) {
    return (
      <button type="button" className="panel ad-card" onClick={onOpen}>
        <img src={a.image ?? art ?? ''} alt={a.title} loading="lazy" />
        <strong>{a.title}</strong>
        {a.subtitle && <small>{a.subtitle}</small>}
        <small className="muted">
          {a.partner} · {t(`ads.where.${a.where}`, { defaultValue: t('ads.where.zone') })} {host ? '· 🔗' : ''}
        </small>
      </button>
    );
  }
  return (
    <article className="panel ad-card ad-full">
      <button type="button" className="btn ghost small" onClick={onClose}>‹ {t('app.back')}</button>
      <img src={a.image ?? art ?? ''} alt={a.title} />
      <h3>{a.title}</h3>
      {a.subtitle && <p>{a.subtitle}</p>}
      <p className="muted">
        {t('ads.by', { partner: a.partner })} · {t(`ads.where.${a.where}`, { defaultValue: t('ads.where.zone') })}
      </p>
      {!host && <p className="muted">{t('ads.noLink')}</p>}
      {host && (
        <button
          className="btn primary big"
          onClick={() => {
            void billboardClick(a.id).catch(() => undefined);
            window.open(a.url!, '_blank', 'noopener,noreferrer');
          }}
        >
          🔗 {t('billboard.visit', { host })}
        </button>
      )}
    </article>
  );
}
