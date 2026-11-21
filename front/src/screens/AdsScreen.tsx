import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdOffer, getShowcase, getSitePartners, type ShowcaseAd, type SitePartner } from '../api/endpoints';
import type { Locale } from '../api/types';
import { changeLang } from '../i18n';
import { fcfa } from '../lib/format';
import { ADS, BOOK } from '../lib/pages';
import ContactForm from '../ui/ContactForm';
import SiteFooter from '../ui/SiteFooter';
import SiteNav from '../ui/SiteNav';
import { matches } from '../lib/search';
import { useSiteReveal } from '../lib/useSiteReveal';

type Offer = Awaited<ReturnType<typeof getAdOffer>>;

/** Lien sortant de l'annonceur : https uniquement (déjà vérifié par le serveur), sinon pas de lien. */
function host(url: string | null): string | null {
  try {
    return url && url.startsWith('https://') ? new URL(url).host : null;
  } catch {
    return null;
  }
}


const External = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Page publique « Annonces » : toutes les publicités en ligne dans le jeu (recherche, filtres) et l'offre aux annonceurs. */
export default function AdsScreen({ paid = false }: { paid?: boolean }) {
  const page = useSiteReveal();
  const { t, i18n } = useTranslation();
  const lang: Locale = i18n.language === 'en' ? 'en' : 'fr';
  const switchLang = (l: Locale) => {
    changeLang(l);
    window.history.replaceState(null, '', ADS[l]);
  };
  // null : chargement (c'est aussi l'état pré-rendu, les annonces changent tous les jours)
  const [ads, setAds] = useState<ShowcaseAd[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [partners, setPartners] = useState<SitePartner[]>([]);
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState('all');
  const [open, setOpen] = useState<{ ad: ShowcaseAd; wheres: Map<string, number> } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    void getShowcase().then(setAds, () => setFailed(true));
    void getAdOffer().then(setOffer, () => undefined);
    void getSitePartners().then(setPartners, () => undefined);
  }, []);

  const placeName = (w: string) => t(`ads.where.${w}`, { defaultValue: t('ads.where.zone') });
  // Filtres : un par emplacement présent, avec le nombre d'annonces
  // Une annonce posée sur plusieurs emplacements (huit panneaux, deux zones en mer…) n'apparaît qu'une fois, avec ses emplacements
  const groups = useMemo(() => {
    const m = new Map<string, { ad: ShowcaseAd; wheres: Map<string, number> }>();
    for (const a of ads ?? []) {
      const k = [a.partner, a.title, a.subtitle, a.url ?? '', a.bg, a.fg, a.hasImage, a.endsAt.slice(0, 10)].join('|');
      const g = m.get(k) ?? { ad: a, wheres: new Map<string, number>() };
      g.wheres.set(a.where, (g.wheres.get(a.where) ?? 0) + 1);
      m.set(k, g);
    }
    return [...m.values()];
  }, [ads]);
  const places = useMemo(() => {
    const n = new Map<string, number>();
    for (const g of groups) for (const w of g.wheres.keys()) n.set(w, (n.get(w) ?? 0) + 1);
    return [...n.entries()];
  }, [groups]);
  const shown = useMemo(() => {
    return groups.filter((g) => (where === 'all' || g.wheres.has(where)) && matches(query, g.ad.title, g.ad.subtitle, g.ad.partner));
  }, [groups, query, where]);
  const filtered = query.trim() !== '' || where !== 'all';
  const until = (d: string) => new Date(d).toLocaleDateString(lang, { day: 'numeric', month: 'long' });

  const email = offer?.contact.email;
  const whatsapp = offer?.contact.whatsapp.replace(/\D/g, '');
  const seaPrice = offer?.plot?.places.find((p) => p.zone === 'sea')?.price ?? null;
  const tierFrom = offer ? Math.min(...Object.values(offer.tiers).map((x) => x.monthlyPrice)) : null;

  return (
    <div className="screen landing site-ads" ref={page}>
      <SiteNav current="ads" onLang={switchLang} />
      <main>
        {/* Retour du paiement d'une réservation faite sur le site */}
        {paid && (
          <div className="site-paid" role="status">
            <div className="landing-wrap">
              <strong>{t('siteAds.paidTitle')}</strong>
              <span>{t('siteAds.paidText')}</span>
            </div>
          </div>
        )}
        <section className="landing-hero howto-hero">
          <div className="landing-wrap">
            <div className="landing-hero-text">
              <span className="landing-kicker">{t('siteAds.kicker')}</span>
              <h1>{t('siteAds.title')}</h1>
              <p className="landing-lead">{t('siteAds.intro')}</p>
              <div className="site-ads-hero-cta">
                <a className="btn primary" href="#ads-live">
                  {t('siteAds.seeAds')}
                </a>
                <a className="btn ghost" href={BOOK[lang]}>
                  {t('siteAds.bookOnline')}
                </a>
              </div>
            </div>
            <ul className="site-ads-stats">
              {(
                [
                  ['live', ads ? String(groups.length) : '–'],
                  ['places', '4'],
                  ['reach', '2'],
                ] as const
              ).map(([k, n]) => (
                <li key={k}>
                  <strong>{n}</strong>
                  <span>{t(`siteAds.stats.${k}.label`)}</span>
                  <small>{t(`siteAds.stats.${k}.detail`)}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section site-ads-live" id="ads-live" aria-labelledby="ads-live-title">
          <div className="landing-wrap">
            <div className="site-ads-head">
              <h2 id="ads-live-title">{t('siteAds.liveTitle')}</h2>
              {groups.length > 0 && <span className="site-ads-count">{t('siteAds.count', { count: shown.length })}</span>}
            </div>

            {ads && ads.length > 0 && (
              <div className="site-ads-tools">
                <label className="site-ads-search">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="sr-only">{t('siteAds.search')}</span>
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('siteAds.searchHint')} maxLength={60} />
                </label>
                <div className="site-ads-chips" role="group" aria-label={t('siteAds.filter')}>
                  <button type="button" aria-pressed={where === 'all'} onClick={() => setWhere('all')}>
                    <span>{t('siteAds.all')}</span>
                    <small>{groups.length}</small>
                  </button>
                  {places.map(([w, n]) => (
                    <button key={w} type="button" aria-pressed={where === w} onClick={() => setWhere(w)}>
                      <span>{placeName(w)}</span>
                      <small>{n}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {failed ? (
              <p className="site-ads-note">{t('siteAds.failed')}</p>
            ) : ads === null ? (
              <p className="site-ads-note">{t('app.loading')}</p>
            ) : filtered && shown.length === 0 ? (
              <div className="site-ads-note">
                <p>{t('siteAds.noMatch', { query: query.trim() })}</p>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    setQuery('');
                    setWhere('all');
                  }}
                >
                  {t('siteAds.reset')}
                </button>
              </div>
            ) : (
              <ul className="site-ads-grid">
                {shown.map(({ ad: a, wheres }) => {
                  const h = host(a.url);
                  return (
                    <li
                      key={a.id}
                      className="site-ad site-ad-open"
                      role="button"
                      tabIndex={0}
                      aria-label={a.title}
                      onClick={() => setOpen({ ad: a, wheres })}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen({ ad: a, wheres }))}
                    >
                      <div className="site-ad-poster">
                        {a.hasImage ? (
                          <img src={`/api/boards/${a.id}/image`} alt={a.title} loading="lazy" style={{ background: a.bg }} />
                        ) : (
                          <div className="site-ad-art" style={{ background: a.bg, color: a.fg }} aria-hidden="true">
                            <strong>{a.title}</strong>
                            {a.subtitle && <span>{a.subtitle}</span>}
                          </div>
                        )}
                        <span className="site-ad-place">{wheres.size === 1 ? `${placeName([...wheres.keys()][0]!)}${[...wheres.values()][0]! > 1 ? ` ×${[...wheres.values()][0]}` : ''}` : t('siteAds.spots', { count: [...wheres.values()].reduce((x, y) => x + y, 0) })}</span>
                      </div>
                      <div className="site-ad-body">
                        <span className="site-ad-by">{a.partner}</span>
                        <h3>{a.title}</h3>
                        {a.subtitle && <p>{a.subtitle}</p>}
                        {wheres.size > 1 && (
                          <p className="site-ad-where">
                            {[...wheres.entries()].map(([w, n]) => `${placeName(w)}${n > 1 ? ` ×${n}` : ''}`).join(' · ')}
                          </p>
                        )}
                        <small>{t('siteAds.until', { date: until(a.endsAt) })}</small>
                        {h && (
                          <a className="site-ad-link" href={a.url!} target="_blank" rel="sponsored noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                            <span>{h}</span>
                            <External />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
                {/* Toujours un espace à vendre en fin de liste (sauf pendant une recherche) */}
                {!filtered && (
                  <li className="site-ad site-ad-free">
                    <a href={BOOK[lang]}>
                      <span className="site-ad-free-mark" aria-hidden="true">+</span>
                      <strong>{t('siteAds.freeTitle')}</strong>
                      <span>{t(groups.length ? 'siteAds.freeText' : 'siteAds.empty')}</span>
                    </a>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        {open && (
          <div className="site-ad-modal" role="presentation" onClick={() => setOpen(null)}>
            <div className="site-ad-dialog" role="dialog" aria-modal="true" aria-label={open.ad.title} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="site-ad-close" aria-label={t('app.close')} onClick={() => setOpen(null)}>
                ×
              </button>
              <div className="site-ad-dialog-poster" style={{ background: open.ad.bg }}>
                {open.ad.hasImage ? (
                  <img src={`/api/boards/${open.ad.id}/image`} alt={open.ad.title} />
                ) : (
                  <div className="site-ad-art" style={{ background: open.ad.bg, color: open.ad.fg }}>
                    <strong>{open.ad.title}</strong>
                    {open.ad.subtitle && <span>{open.ad.subtitle}</span>}
                  </div>
                )}
              </div>
              <div className="site-ad-dialog-body">
                <span className="site-ad-by">{open.ad.partner}</span>
                <h3>{open.ad.title}</h3>
                {open.ad.subtitle && <p>{open.ad.subtitle}</p>}
                <ul className="site-ad-dialog-places">
                  {[...open.wheres.entries()].map(([w, n]) => (
                    <li key={w}>
                      {placeName(w)}
                      {n > 1 ? ` ×${n}` : ''}
                    </li>
                  ))}
                </ul>
                <small>{t('siteAds.until', { date: until(open.ad.endsAt) })}</small>
                {host(open.ad.url) && (
                  <a className="site-ad-link" href={open.ad.url!} target="_blank" rel="sponsored noopener noreferrer">
                    <span>{host(open.ad.url)}</span>
                    <External />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Nos partenaires : seulement si l'équipe l'affiche (réglage partners.showcase) et en a coché */}
        {partners.length > 0 && (
          <section className="landing-section site-ads-partners" aria-labelledby="ads-partners-title">
            <div className="landing-wrap">
              <h2 id="ads-partners-title">{t('siteAds.partnersTitle')}</h2>
              <p className="site-ads-sell-lead">{t('siteAds.partnersText')}</p>
              <ul className="site-partners">
                {partners.map((p) => {
                  const h = host(p.website);
                  const body = (
                    <>
                      <span className="site-partner-mark" style={{ background: p.color ?? undefined }} aria-hidden="true">
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="site-partner-text">
                        <strong>{p.name}</strong>
                        <small>{t(`billboard.kinds.${p.kind}`)}</small>
                      </span>
                      {p.tier !== 'NONE' && <span className={`site-partner-tier tier-${p.tier}`}>{t(`partners.tier.${p.tier}`)}</span>}
                    </>
                  );
                  return (
                    <li key={p.id}>
                      {h ? (
                        <a href={p.website!} target="_blank" rel="noopener noreferrer" title={h}>
                          {body}
                        </a>
                      ) : (
                        <div>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <section className="landing-section site-ads-sell" id="ads-sell" aria-labelledby="ads-sell-title">
          <div className="landing-wrap">
            <span className="landing-kicker">{t('siteAds.sellKicker')}</span>
            <h2 id="ads-sell-title">{t('siteAds.sellTitle')}</h2>
            <p className="site-ads-sell-lead">{t('siteAds.sellText')}</p>

            <ul className="site-ads-offers">
              <li>
                <h3>{t('siteAds.offerBoard')}</h3>
                <p className="site-ads-price">{offer?.board ? fcfa(offer.board.price) : '–'}</p>
                <small>{offer?.board ? t('siteAds.perDays', { days: offer.board.days }) : ' '}</small>
                <p>{t('siteAds.offerBoardText')}</p>
                {offer?.boardFixed && <small>{t('siteAds.offerBoardFixed', { price: fcfa(offer.boardFixed.price) })}</small>}
              </li>
              <li className="featured">
                <h3>{t('siteAds.offerPlot')}</h3>
                <p className="site-ads-price">{offer?.plot ? t('siteAds.from', { price: fcfa(offer.plot.price) }) : '–'}</p>
                <small>{offer?.plot ? t('siteAds.perSquare', { days: offer.plot.periodDays }) : ' '}</small>
                <p>{t('siteAds.offerPlotText')}</p>
                {offer?.plot && (
                  <ul className="site-ads-places">
                    {offer.plot.places.map((p) => (
                      <li key={p.zone}>
                        <span>{placeName(p.zone)}</span>
                        <strong>{fcfa(p.price)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                {seaPrice != null && <small className="site-ads-example">{t('siteAds.plotExample', { price: fcfa(seaPrice * 36), days: offer!.plot!.periodDays })}</small>}
              </li>
              <li>
                <h3>{t('siteAds.offerPartner')}</h3>
                <p className="site-ads-price">{tierFrom !== null ? t('siteAds.from', { price: fcfa(tierFrom) }) : '–'}</p>
                <small>{t('siteAds.perMonth')}</small>
                <p>{t('siteAds.offerPartnerText', { price: tierFrom !== null ? fcfa(tierFrom) : '–' })}</p>
                {offer && (
                  <ul className="site-ads-tiers">
                    {(['BRONZE', 'SILVER', 'GOLD'] as const).map((k) => {
                      const x = offer.tiers[k];
                      return (
                        <li key={k} className={`tier-${k.toLowerCase()}`}>
                          <div className="site-ads-tier-head">
                            <strong>{t(`siteAds.tier.${k}`)}</strong>
                            <span>{t('siteAds.tierPrice', { price: fcfa(x.monthlyPrice) })}</span>
                          </div>
                          <ul>
                            {x.brandPlace && <li>{t('siteAds.perk.building')}</li>}
                            {x.boards > 0 && <li>{t('siteAds.perk.boards', { count: x.boards })}</li>}
                            {x.rotating > 0 && <li>{t('siteAds.perk.rotating', { count: x.rotating })}</li>}
                            {x.eventsPerMonth > 0 && <li>{t('siteAds.perk.events', { count: x.eventsPerMonth })}</li>}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            </ul>

            <h3 className="site-ads-steps-title">{t('siteAds.stepsTitle')}</h3>
            <ol className="site-ads-steps">
              {(['choose', 'pay', 'live'] as const).map((k, i) => (
                <li key={k}>
                  <span aria-hidden="true">{i + 1}</span>
                  <div>
                    <strong>{t(`siteAds.steps.${k}.title`)}</strong>
                    <p>{t(`siteAds.steps.${k}.text`)}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="site-ads-contact">
              <a className="btn primary big" href={BOOK[lang]}>
                {t('siteAds.bookOnline')}
              </a>
              <a className="btn ghost big" href="#ads-contact">
                {t('siteAds.writeUs')}
              </a>
              {whatsapp && (
                <a className="btn ghost big" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              )}
            </div>
            <div className="site-ads-form" id="ads-contact">
              <h3>{t('siteAds.formTitle')}</h3>
              <p>{t('siteAds.formText')}</p>
              <ContactForm topic="board" />
              {email && <small className="site-ads-mail">{t('siteAds.orMail')} <a href={`mailto:${email}`}>{email}</a></small>}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
