import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { getBoardSlots, getCatalog, getPlots, type SeaGrid, type SeaPlot } from '../api/endpoints';
import type { Catalog, Locale, Me } from '../api/types';
import { changeLang, errorText } from '../i18n';
import { fcfa } from '../lib/format';
import { ADS, BOOK, CONTACT } from '../lib/pages';
import { Ctx, type GameCtx } from '../phone/ctx';
import BookBoard from '../ui/BookBoard';
import BookPlot from '../ui/BookPlot';
import SiteFooter from '../ui/SiteFooter';
import SiteNav from '../ui/SiteNav';

type Plots = Awaited<ReturnType<typeof getPlots>>;
interface Space {
  zone: string;
  grid: SeaGrid;
  price: number;
  plots: SeaPlot[];
}

// Plan des panneaux numérotés (mêmes emplacements de départ que World.buildBillboards), vu de dessus, la mer en bas
const ROADS_Z = [14, -30, -70, -110];
const ROADS_X = [-90, -40, 0, 40, 90];
const BOARD_SPOTS: [number, number][] = [
  ...[4, -40, -80].flatMap((z) => [-120, -72, -24, 24, 72, 120].map((x) => [x + 10, z] as [number, number])),
  ...[-30, 50].flatMap((x) => [-120, -75, -30].map((z) => [x, z + 12] as [number, number])),
];

/**
 * Réserver un espace de pub depuis le site, sans entrer dans le jeu : choix de l'espace (panneau, mer, est, lagunes),
 * de l'emplacement (plan des panneaux ou grille de cases), de l'affiche, puis paiement réel. Mêmes formulaires et mêmes
 * contrôles serveur que dans le jeu ; après paiement, retour sur la page « Annonces ».
 */
export default function BookAdScreen({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const lang: Locale = i18n.language === 'en' ? 'en' : 'fr';
  const switchLang = (l: Locale) => {
    changeLang(l);
    window.history.replaceState(null, '', BOOK[l]);
  };
  const [plots, setPlots] = useState<Plots | null>(null);
  const [slots, setSlots] = useState<Awaited<ReturnType<typeof getBoardSlots>> | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [space, setSpace] = useState<string | null>(null);
  const [board, setBoard] = useState<number | null>(null);
  const [kind, setKind] = useState<'rotating' | 'fixed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    void Promise.all([getPlots(), getBoardSlots(), getCatalog()]).then(
      ([p, s, c]) => {
        setPlots(p);
        setSlots(s);
        setCatalog(c);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(() => {
    if (!me.guest) load();
  }, [me.guest, load]);

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    setToastMsg({ msg, kind });
    window.setTimeout(() => setToastMsg(null), 5000);
  }, []);
  // Les formulaires de réservation du jeu n'utilisent que me, catalog, run, busy et toast : le reste est inerte ici
  const ctx = useMemo(() => {
    const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      try {
        return await fn();
      } catch (e) {
        toast(errorText(e instanceof ApiError ? e.code : 'network_error'), 'error');
        // Emplacement pris entre-temps : on recharge le plan et la grille
        if (e instanceof ApiError && (e.code === 'board_taken' || e.code === 'rotation_full' || e.code === 'plot_taken')) load();
        return null;
      } finally {
        setBusy(false);
      }
    };
    const noop = () => undefined;
    return { me, catalog, run, busy, toast, openApp: noop, closePhone: noop } as unknown as GameCtx;
  }, [me, catalog, busy, toast, load]);

  const spaces: Space[] = useMemo(() => {
    if (!plots) return [];
    const list: Space[] = [];
    if (plots.pricePerPlot != null) list.push({ zone: 'sea', grid: plots.grid, price: plots.pricePerPlot, plots: plots.plots });
    for (const z of plots.zones ?? []) if (z.price != null) list.push({ zone: z.id, grid: z.grid, price: z.price, plots: z.plots });
    return list;
  }, [plots]);
  const chosen = spaces.find((s) => s.zone === space) ?? null;
  const boardPrice = catalog?.board?.priceAmount ?? null;
  const boardFixedPrice = catalog?.boardFixed?.priceAmount ?? null;
  // Panneaux vendables en fixe : libres et hors de ceux gardés pour la rotation
  const freeBoards = slots ? Math.max(0, Math.min(slots.count, slots.rotationFrom) - slots.taken.filter((n) => n < slots.rotationFrom).length) : 0;
  const rotationOpen = !!slots && slots.rotating < slots.rotatingMax;
  const placeName = (z: string) => t(`ads.where.${z}`, { defaultValue: t('ads.where.zone') });
  const icon = (z: string) => (z === 'board' ? '🪧' : z === 'sea' ? '🌊' : z.startsWith('lac') ? '🛶' : '📢');

  return (
    <Ctx.Provider value={ctx}>
      <div className="screen landing site-book">
        <SiteNav current="ads" onLang={switchLang} />
        <main>
          <section className="landing-hero howto-hero">
            <div className="landing-wrap">
              <div className="landing-hero-text">
                <span className="landing-kicker">{t('siteBook.kicker')}</span>
                <h1>{t('siteBook.title')}</h1>
                <p className="landing-lead">{t('siteBook.intro')}</p>
                <small className="landing-free">{t('siteBook.signedIn', { name: me.username ?? me.email ?? me.phone ?? '' })}</small>
              </div>
            </div>
          </section>

          <section className="landing-section">
            <div className="landing-wrap">
              {me.guest ? (
                <div className="site-ads-note site-book-guest">
                  <p>{t('siteBook.guest')}</p>
                  <button className="btn primary" onClick={onLogout}>
                    {t('siteBook.guestCta')}
                  </button>
                </div>
              ) : failed ? (
                <div className="site-ads-note">
                  <p>{t('siteAds.failed')}</p>
                  <button className="btn ghost small" onClick={load}>
                    {t('app.retry')}
                  </button>
                </div>
              ) : !plots || !slots ? (
                <p className="site-ads-note">{t('app.loading')}</p>
              ) : (
                <>
                  <h2 className="site-book-step">
                    <span>1</span> {t('siteBook.step1')}
                  </h2>
                  <ul className="site-book-spaces">
                    {boardPrice != null && (
                      <li>
                        <button type="button" aria-pressed={space === 'board'} disabled={freeBoards === 0 && !rotationOpen} onClick={() => (setSpace('board'), setBoard(null), setKind(null))}>
                          <span className="site-book-ico" aria-hidden="true">{icon('board')}</span>
                          <strong>{placeName('board')}</strong>
                          <span className="site-book-price">{fcfa(boardPrice)}</span>
                          <small>{t('siteBook.perBoard', { days: 7 })}</small>
                          <small className="site-book-free">{freeBoards || rotationOpen ? t('siteBook.boardFrom') : t('siteBook.noBoard')}</small>
                        </button>
                      </li>
                    )}
                    {spaces.map((s) => (
                      <li key={s.zone}>
                        <button type="button" aria-pressed={space === s.zone} onClick={() => setSpace(s.zone)}>
                          <span className="site-book-ico" aria-hidden="true">{icon(s.zone)}</span>
                          <strong>{placeName(s.zone)}</strong>
                          <span className="site-book-price">{fcfa(s.price)}</span>
                          <small>{t('siteBook.perSquare', { days: plots.periodDays ?? 7 })}</small>
                          <small className="site-book-free">{t('siteBook.grid', { cols: s.grid.cols, rows: s.grid.rows, max: s.grid.maxSide })}</small>
                        </button>
                      </li>
                    ))}
                    <li>
                      <a href={`${CONTACT[lang]}#partner`}>
                        <span className="site-book-ico" aria-hidden="true">🤝</span>
                        <strong>{t('siteAds.offerPartner')}</strong>
                        <span className="site-book-price">{t('siteBook.onQuote')}</span>
                        <small>{t('siteBook.partnerText')}</small>
                      </a>
                    </li>
                  </ul>

                  {space === 'board' && (
                    <div className="site-book-board">
                      <h2 className="site-book-step">
                        <span>2</span> {t('siteBook.step2board')}
                      </h2>
                      <div className="site-book-kinds" role="group" aria-label={t('book.kind')}>
                        <button type="button" aria-pressed={kind === 'rotating'} disabled={!rotationOpen} onClick={() => (setKind('rotating'), setBoard(null))}>
                          <strong>{t('siteBook.kindRotating')}</strong>
                          <span className="site-book-price">{fcfa(boardPrice ?? 0)}</span>
                          <small>{rotationOpen ? t('siteBook.kindRotatingText') : t('book.kindRotatingFull')}</small>
                        </button>
                        {boardFixedPrice != null && (
                          <button type="button" aria-pressed={kind === 'fixed'} disabled={freeBoards === 0} onClick={() => setKind('fixed')}>
                            <strong>{t('siteBook.kindFixed')}</strong>
                            <span className="site-book-price">{fcfa(boardFixedPrice)}</span>
                            <small>{t('siteBook.kindFixedText', { count: freeBoards })}</small>
                          </button>
                        )}
                      </div>
                      {kind === 'rotating' && (
                        <div className="site-book-form">
                          <h2 className="site-book-step">
                            <span>3</span> {t('siteBook.step3rotating')}
                          </h2>
                          <BookBoard panel={null} lock="rotating" site={lang} startOpen onCancel={() => setKind(null)} />
                        </div>
                      )}
                      {kind === 'fixed' && (
                        <>
                          <h2 className="site-book-step">
                            <span>3</span> {t('siteBook.step2board')}
                          </h2>
                          <BoardPlan count={slots.count} taken={slots.taken} reservedFrom={slots.rotationFrom} value={board} onPick={setBoard} />
                          {board !== null && (
                            <div className="site-book-form">
                              <h2 className="site-book-step">
                                <span>4</span> {t('siteBook.step3', { n: board + 1 })}
                              </h2>
                              <BookBoard key={board} panel={board} lock="fixed" site={lang} startOpen onCancel={() => setBoard(null)} />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              <p className="site-book-back">
                <a href={ADS[lang]}>← {t('siteBook.back')}</a>
              </p>
            </div>
          </section>
        </main>
        <SiteFooter />
        {/* Cases : la même fenêtre que dans le jeu (grille, taille, durée, affiche, paiement) */}
        {chosen && (
          <BookPlot zone={chosen.zone} grid={chosen.grid} price={chosen.price} periodDays={plots?.periodDays ?? 7} periods={plots?.periods?.length ? plots.periods : [1]} plots={chosen.plots} x={0} y={0} site={lang} onClose={() => setSpace(null)} />
        )}
        {toastMsg && (
          <div className={`site-toast ${toastMsg.kind}`} role={toastMsg.kind === 'error' ? 'alert' : 'status'}>
            {toastMsg.msg}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

/** Plan des panneaux de la ville : un point par panneau numéroté, les panneaux pris sont grisés. */
function BoardPlan({ count, taken, reservedFrom, value, onPick }: { count: number; taken: number[]; /** Numéros à partir desquels les panneaux restent à la rotation (jamais vendus en fixe). */ reservedFrom: number; value: number | null; onPick: (n: number) => void }) {
  const { t } = useTranslation();
  const spots = BOARD_SPOTS.slice(0, count);
  return (
    <div className="site-book-plan">
      <svg viewBox="-140 -132 280 182" role="group" aria-label={t('siteBook.plan')}>
        <rect x="-140" y="22" width="280" height="28" className="plan-sea" />
        <text x="0" y="40" className="plan-sea-label">
          {t('siteBook.sea')}
        </text>
        {ROADS_Z.map((z) => (
          <line key={`z${z}`} x1="-135" x2="135" y1={z} y2={z} className="plan-road" />
        ))}
        {ROADS_X.map((x) => (
          <line key={`x${x}`} x1={x} x2={x} y1="-125" y2="14" className="plan-road" />
        ))}
        {spots.map(([x, z], i) => {
          const isTaken = taken.includes(i) || i >= reservedFrom;
          return (
            <g
              key={i}
              className={`plan-board${isTaken ? ' taken' : ''}${value === i ? ' on' : ''}`}
              role="button"
              tabIndex={isTaken ? -1 : 0}
              aria-disabled={isTaken}
              aria-pressed={value === i}
              aria-label={t(isTaken ? 'siteBook.boardTaken' : 'siteBook.boardFree', { n: i + 1 })}
              onClick={() => !isTaken && onPick(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !isTaken && (e.preventDefault(), onPick(i))}
            >
              <rect x={x - 9} y={z - 6} width="18" height="12" rx="3" />
              <text x={x} y={z + 3.5}>
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="site-book-legend">
        <span>
          <i className="free" /> {t('siteBook.legendFree')}
        </span>
        <span>
          <i className="taken" /> {t('siteBook.legendTaken')}
        </span>
        <span>
          <i className="on" /> {t('siteBook.legendChosen')}
        </span>
      </div>
    </div>
  );
}
