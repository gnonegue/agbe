import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buyLandQuarters, getLand, getLandCell, getLandMarket, getLandZone, getMyLand, landBuyListing, landCollect, landList, landMerge, landMoveIn, landStep, landUnlist, landUse, quoteLand,
  type LandCatalog, type LandCellInfo, type LandHolding, type LandListing, type LandMine, type LandPick, type LandQuote, type LandStatus, type LandUse, type LandZonePlan,
} from '../api/endpoints';
import { fcfa, gameDuration, localName } from '../lib/format';
import AccountGate from '../ui/AccountGate';
import { takeLandFocus, type LandFocus } from '../lib/landFocus';
import { useGame } from './ctx';

type Tab = 'zones' | 'mine' | 'market';
const STEPS: LandStatus[] = ['BOUGHT', 'SURVEYED', 'OPINION', 'TITLED'];
const QUARTERS = [0, 1, 2, 3];
const popcount = (m: number) => QUARTERS.filter((q) => (m >> q) & 1).length;
const pct = (bp: number) => `${(bp / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`;

/** Foncier : terrains par quarts de lot au prix du m² selon la position, titre foncier, exploitation et revente. */
export default function LandApp() {
  const { t } = useTranslation();
  const { run, reloadLand } = useGame();
  // Lot touché sur la carte : on s'ouvre sur sa zone et son lot
  const [focus] = useState<LandFocus | null>(() => takeLandFocus());
  const [tab, setTab] = useState<Tab>('zones');
  const [cat, setCat] = useState<LandCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const loadCat = useCallback(async () => {
    const r = await run(getLand);
    if (r) setCat(r);
    else setFailed(true);
  }, [run]);
  useEffect(() => {
    void loadCat();
  }, [loadCat]);
  /** Après un achat, une démarche ou une vente : relire le catalogue et redessiner la carte. */
  const changed = useCallback(async () => {
    await loadCat();
    reloadLand();
  }, [loadCat, reloadLand]);

  if (!cat)
    return failed ? (
      <div className="panel">
        <p className="muted">{t('app.loadFailed')}</p>
        <button className="btn" onClick={() => (setFailed(false), void loadCat())}>{t('app.retry')}</button>
      </div>
    ) : (
      <p className="muted">{t('app.loading')}</p>
    );

  const used = Math.min(100, Math.round((cat.ownedM2 * 100) / cat.maxM2));
  return (
    <section className="ld">
      <div className="ld-hero">
        <small>{t('land.owned')}</small>
        <strong>{cat.ownedM2.toLocaleString()} m²</strong>
        <div className="ld-gauge" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-label={t('land.limitLabel')}>
          <span className={`fill w${Math.round(used / 5) * 5}`} />
        </div>
        <small>{t('land.limit', { max: cat.maxM2.toLocaleString(), ha: (cat.maxM2 / 10_000).toLocaleString() })}</small>
      </div>
      <div className="chat-tabs" role="tablist">
        {(['zones', 'mine', 'market'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(k)}>
            {k === 'zones' ? '🗺️' : k === 'mine' ? '📜' : '🤝'} {t(`land.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'zones' && <ZonesTab cat={cat} onChanged={changed} focus={focus} />}
      {tab === 'mine' && <MineTab cat={cat} onChanged={changed} />}
      {tab === 'market' && <MarketTab cat={cat} onChanged={changed} />}
    </section>
  );
}

// ---------- Terrains à vendre ----------

function ZonesTab({ cat, onChanged, focus }: { cat: LandCatalog; onChanged: () => Promise<void>; focus: LandFocus | null }) {
  const { t, i18n } = useTranslation();
  const { run, busy, showLand } = useGame();
  const [zoneId, setZoneId] = useState<string | null>(focus?.zoneId ?? null);
  const pendingCell = useRef<number | undefined>(focus?.cell);
  const [plan, setPlan] = useState<LandZonePlan | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [info, setInfo] = useState<LandCellInfo | null>(null);
  const [picking, setPicking] = useState<number[]>([]);
  const [cart, setCart] = useState<LandPick[]>([]);
  const [quote, setQuote] = useState<LandQuote | null>(null);

  const loadPlan = useCallback(async (id: string) => {
    const r = await run(() => getLandZone(id));
    if (r) {
      setPlan(r);
      // Lot touché sur la carte : il est déjà choisi à l'ouverture
      if (pendingCell.current !== undefined) {
        const c = pendingCell.current;
        pendingCell.current = undefined;
        if (c < r.price.length) setSel(c);
      }
    }
  }, [run]);
  useEffect(() => {
    setPlan(null);
    setSel(null);
    setCart([]);
    setQuote(null);
    if (zoneId) void loadPlan(zoneId);
  }, [zoneId, loadPlan]);

  // Détail du prix de la cellule touchée (centralité, route, littoral)
  useEffect(() => {
    setInfo(null);
    if (zoneId === null || sel === null) return;
    let off = false;
    void getLandCell(zoneId, sel).then((r) => !off && setInfo(r), () => undefined);
    return () => {
      off = true;
    };
  }, [zoneId, sel]);

  // Devis du panier : le total est calculé par le serveur
  useEffect(() => {
    if (!zoneId || cart.length === 0) {
      setQuote(null);
      return;
    }
    let off = false;
    const id = window.setTimeout(() => void quoteLand(zoneId, cart).then((r) => !off && setQuote(r), () => !off && setQuote(null)), 250);
    return () => {
      off = true;
      window.clearTimeout(id);
    };
  }, [zoneId, cart]);

  const tiers = useMemo(() => {
    if (!plan) return { lo: 0, hi: 1 };
    return { lo: Math.min(...plan.price), hi: Math.max(...plan.price) };
  }, [plan]);

  const zone = cat.zones.find((z) => z.id === zoneId) ?? null;
  const pickCell = (i: number) => {
    setSel(i);
    const inCart = cart.find((p) => p.cell === i);
    setPicking(inCart ? inCart.quarters : []);
  };
  const freeMask = sel !== null && plan ? plan.free[sel]! : 0;
  const mineMask = sel !== null && plan ? plan.mine[sel]! : 0;
  const preset = (n: number) => setPicking(QUARTERS.filter((q) => (freeMask >> q) & 1).slice(0, n));
  const toggleQ = (q: number) => setPicking((cur) => (cur.includes(q) ? cur.filter((x) => x !== q) : [...cur, q]));
  const addToCart = () => {
    if (sel === null || picking.length === 0) return;
    setCart((c) => [...c.filter((p) => p.cell !== sel), { cell: sel, quarters: [...picking].sort() }]);
  };
  const buy = async () => {
    if (!zoneId || cart.length === 0 || !quote) return;
    const r = await run(() => buyLandQuarters(zoneId, cart), () => t('land.bought', { m2: quote.m2 }));
    if (r) {
      setCart([]);
      setQuote(null);
      await Promise.all([loadPlan(zoneId), onChanged()]);
    }
  };

  if (!zone)
    return (
      <div className="ld-zones">
        <p className="muted">{t('land.zonesIntro', { lot: cat.lotM2, quarter: cat.quarterM2 })}</p>
        {cat.zones.map((z) => {
          const soldPct = Math.round((z.soldQuarters * 100) / z.totalQuarters);
          return (
            <button key={z.id} className="ld-zone" onClick={() => setZoneId(z.id)}>
              <strong>{z.water ? '🌊 ' : ''}{localName(z, i18n.language)}</strong>
              {z.water && <small className="ld-grows">{t('land.seaNote')}</small>}
              <small>{i18n.language === 'en' ? z.descEn : z.descFr}</small>
              {z.planRows > z.layout.rows && <small className="ld-grows">🌱 {t('land.grows', { open: z.layout.cols * z.layout.rows, plan: z.layout.cols * z.planRows })}</small>}
              <span className="ld-zone-row">
                <b>{t('land.priceRange', { min: fcfa(z.minPerM2), max: fcfa(z.maxPerM2) })}</b>
                <span>{t('land.sold', { pct: soldPct })}</span>
              </span>
            </button>
          );
        })}
      </div>
    );

  const m2OfPicking = popcount(picking.reduce((m, q) => m | (1 << q), 0)) * cat.quarterM2;
  const perM2Sel = sel !== null && plan ? plan.price[sel]! : 0;
  return (
    <div className="ld-zone-view">
      <div className="row-between">
        <button className="btn ghost small" onClick={() => setZoneId(null)}>‹ {t('land.allZones')}</button>
        <button className="btn small" onClick={() => showLand(zone.id)}>🗺️ {t('land.seeMap')}</button>
      </div>
      <strong>{localName(zone, i18n.language)}</strong>
      <p className="muted small-line">{t('land.gridHint', { lot: cat.lotM2 })}</p>
      {plan && plan.planRows > plan.layout.rows && <p className="muted small-line">🌱 {t('land.grows', { open: plan.layout.cols * plan.layout.rows, plan: plan.layout.cols * plan.planRows })}</p>}
      {!plan ? (
        <p className="muted">{t('app.loading')}</p>
      ) : (
        <>
          <div className="ld-grid" style={{ gridTemplateColumns: `repeat(${plan.layout.cols}, 1fr)` }}>
            {plan.price.map((p, i) => {
              const f = plan.free[i]!;
              const level = tiers.hi === tiers.lo ? 0 : Math.min(4, Math.floor(((p - tiers.lo) * 5) / (tiers.hi - tiers.lo + 1)));
              const cls = ['ld-cell', `t${level}`, f === 0 ? 'sold' : f !== 15 ? 'part' : '', plan.mine[i] ? 'mine' : '', cart.some((c) => c.cell === i) ? 'cart' : '', sel === i ? 'sel' : ''].filter(Boolean).join(' ');
              return <button key={i} type="button" className={cls} disabled={f === 0 && !plan.mine[i]} onClick={() => pickCell(i)} aria-label={t('land.cell', { n: i + 1 })} />;
            })}
          </div>
          <div className="ld-legend">
            <span><i className="ld-sw t0" /> {t('land.cheap')}</span>
            <span><i className="ld-sw t4" /> {t('land.dear')}</span>
            <span><i className="ld-sw sold" /> {t('land.taken')}</span>
            <span><i className="ld-sw mine" /> {t('land.yours')}</span>
          </div>

          {sel !== null && (
            <div className="panel ld-cellpanel">
              <div className="row-between">
                <strong>{t('land.cell', { n: sel + 1 })}</strong>
                <b className="ld-price">{t('land.perM2', { price: fcfa(perM2Sel) })}</b>
              </div>
              {info && (
                <div className="ld-why" aria-label={t('land.why')}>
                  {info.fixed ? (
                    <span>{t('land.whyFixed')}</span>
                  ) : (
                    <>
                      <span>{t('land.whyCentre', { pct: pct(info.centralityBp) })}</span>
                      {info.roadBp > 0 && <span>🛣️ +{pct(info.roadBp)}</span>}
                      {info.seaBp > 0 && <span>🌊 +{pct(info.seaBp)}</span>}
                      {info.tierBp !== 10_000 && <span>{t('land.whyZone', { pct: pct(info.tierBp) })}</span>}
                    </>
                  )}
                </div>
              )}
              <div className="ld-quarters" role="group" aria-label={t('land.quarters')}>
                {QUARTERS.map((q) => {
                  const free = (freeMask >> q) & 1;
                  const mine = (mineMask >> q) & 1;
                  return (
                    <button key={q} type="button" disabled={!free} className={mine ? 'ld-q mine' : !free ? 'ld-q taken' : picking.includes(q) ? 'ld-q on' : 'ld-q'} onClick={() => toggleQ(q)}>
                      {mine ? '✓' : !free ? '✕' : cat.quarterM2}
                      <small>m²</small>
                    </button>
                  );
                })}
              </div>
              <div className="sv-chips">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} type="button" className="sv-chip" disabled={popcount(freeMask) < n} onClick={() => preset(n)}>
                    {n === 4 ? t('land.fullLot', { m2: cat.lotM2 }) : `${n * cat.quarterM2} m²`}
                  </button>
                ))}
              </div>
              <button className="btn primary" disabled={picking.length === 0} onClick={addToCart}>
                ➕ {t('land.addCart', { m2: m2OfPicking, price: fcfa(BigInt(perM2Sel) * BigInt(m2OfPicking)) })}
              </button>
            </div>
          )}

          {cart.length > 0 && (
            <div className="panel ld-cart">
              <strong>🛒 {t('land.cart')}</strong>
              <ul className="ld-cart-list">
                {(quote?.items ?? cart.map((c) => ({ cell: c.cell, quarters: c.quarters, m2: c.quarters.length * cat.quarterM2, perM2: '0', price: '0' }))).map((it) => (
                  <li key={it.cell}>
                    <span>{t('land.cell', { n: it.cell + 1 })} · {it.m2} m²</span>
                    <b>{quote ? fcfa(it.price) : '…'}</b>
                    <button type="button" className="btn ghost small" aria-label={t('land.remove')} onClick={() => setCart((c) => c.filter((p) => p.cell !== it.cell))}>✕</button>
                  </li>
                ))}
              </ul>
              {quote && (
                <div className="ld-totals">
                  <span>{t('land.total', { m2: quote.m2 })}<b>{fcfa(quote.total)}</b></span>
                  <span>{t('land.fee', { pct: pct(cat.purchaseFeeBp) })}<b>{fcfa(quote.fee)}</b></span>
                  <span className="grand">{t('land.grand')}<b>{fcfa(quote.grand)}</b></span>
                  {quote.overLimit && <small className="sv-warn">{t('land.overLimit', { max: cat.maxM2.toLocaleString() })}</small>}
                </div>
              )}
              <AccountGate>
                <button className="btn primary big" disabled={busy || !quote || quote.overLimit} onClick={() => void buy()}>
                  {t('land.buy')}
                </button>
              </AccountGate>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Mes terrains : titre foncier, exploitation, revente ----------

function remainingGameHours(iso: string, secondsPerGameDay: number): number {
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : (ms / 1000) * (24 / (secondsPerGameDay || 3600));
}

function MineTab({ cat, onChanged }: { cat: LandCatalog; onChanged: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy, state } = useGame();
  const [mine, setMine] = useState<LandMine | null>(null);
  const [, tick] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const load = useCallback(async () => {
    const r = await run(getMyLand);
    if (r) setMine(r);
  }, [run]);
  useEffect(() => {
    void load();
    // Les démarches et chantiers aboutissent avec le temps : on relit régulièrement
    const id = window.setInterval(() => {
      tick((n) => n + 1);
      void getMyLand().then(setMine, () => undefined);
    }, 20_000);
    return () => window.clearInterval(id);
  }, [load]);
  const zoneName = (id: string) => {
    const z = cat.zones.find((x) => x.id === id);
    return z ? localName(z, i18n.language) : id;
  };
  const after = async () => {
    await Promise.all([load(), onChanged()]);
  };
  if (!mine) return <p className="muted">{t('app.loading')}</p>;
  if (mine.holdings.length === 0) return <p className="muted">{t('land.noneMine')}</p>;
  return (
    <div className="ld-mine">
      {mine.holdings.filter((h) => !h.use && !h.ask && !h.step).length >= 2 && (
        <p className="muted">{t('land.mergeHint')}</p>
      )}
      {mine.holdings.map((h) => (
        <div key={h.id}>
          {!h.use && !h.ask && !h.step && mine.holdings.length >= 2 && (
            <label className="row-between">
              <span>{t('land.mergePick')}</span>
              <input type="checkbox" checked={picked.includes(h.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, h.id] : p.filter((x) => x !== h.id)))} />
            </label>
          )}
          <HoldingCard h={h} cat={cat} zoneName={zoneName(h.zoneId)} secondsPerGameDay={state.secondsPerGameDay} busy={busy} run={run} onChanged={after} />
        </div>
      ))}
      {picked.length >= 2 && (
        <button className="btn primary" disabled={busy} onClick={() => void run(() => landMerge(picked), (r) => t('land.merged', { m2: r.result.m2 })).then(async (r) => { if (r) setPicked([]); await after(); })}>
          🔗 {t('land.merge', { n: picked.length })}
        </button>
      )}
    </div>
  );
}

function HoldingCard({ h, cat, zoneName, secondsPerGameDay, busy, run, onChanged }: {
  h: LandHolding;
  cat: LandCatalog;
  zoneName: string;
  secondsPerGameDay: number;
  busy: boolean;
  run: ReturnType<typeof useGame>['run'];
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [ask, setAsk] = useState(() => Number(BigInt(h.value)));
  const idx = STEPS.indexOf(h.status);
  const inProgress = h.step ? remainingGameHours(h.step.readyAt, secondsPerGameDay) : 0;
  const use = h.use ? cat.uses.find((u) => u.id === h.use!.id) : undefined;
  const useLeft = h.use?.readyAt ? remainingGameHours(h.use.readyAt, secondsPerGameDay) : 0;
  const useCostFor = (u: LandUse) => BigInt(u.cost) + BigInt(u.costPerM2) * BigInt(h.m2);
  return (
    <div className="panel ld-holding">
      <div className="row-between">
        <strong>{zoneName} · {h.cells && h.cells.length > 1 ? t('land.cells', { list: h.cells.map((c) => c + 1).join(' + ') }) : t('land.cell', { n: h.cell + 1 })}</strong>
        <b>{h.m2} m²</b>
      </div>
      <small className="muted">{t('land.value', { value: fcfa(h.value), paid: fcfa(h.paid) })}</small>

      <ol className="ld-steps" aria-label={t('land.procedure')}>
        {STEPS.map((s, i) => (
          <li key={s} className={i < idx ? 'done' : i === idx ? 'now' : h.step?.target === s ? 'wip' : ''}>
            <i aria-hidden="true">{i <= idx ? '✓' : h.step?.target === s ? '⏳' : i + 1}</i>
            <span>{t(`land.status.${s}`)}</span>
          </li>
        ))}
      </ol>
      {h.titleNo && <div className="ld-title">📜 {t('land.titleNo', { no: h.titleNo })}</div>}

      {h.step && <p className="ld-wip">⏳ {t('land.stepWip', { step: t(`land.stepDoing.${h.step.target}`), time: gameDuration(inProgress) })}</p>}
      {!h.step && h.next && !h.ask && (
        <button className="btn primary" disabled={busy} onClick={() => void run(() => landStep(h.id), () => t('land.stepStarted', { step: t(`land.stepName.${h.next!.step}`) })).then(onChanged)}>
          {t(`land.stepName.${h.next.step}`)} · {fcfa(h.next.fee)}
          <small>{t('land.stepDelay', { time: gameDuration(h.next.gameHours) })}</small>
        </button>
      )}
      {!h.step && h.next && <small className="muted">{t(`land.stepHelp.${h.next.step}`)}</small>}

      {h.status === 'TITLED' && !h.use && !h.ask && (
        <div className="ld-uses">
          <strong>{t('land.useTitle')}</strong>
          {(['HOUSE', 'BUSINESS'] as const).map((kind) => (
            <div key={kind} className="ld-use-group">
              <h5>{kind === 'HOUSE' ? `🏠 ${t('land.houses')}` : `💼 ${t('land.businesses')}`}</h5>
              {cat.uses.filter((u) => u.kind === kind).map((u) => {
                const small = h.m2 < u.minM2;
                const desc = i18n.language === 'en' ? u.descEn : u.descFr;
                return (
                  <button key={u.id} className="ld-use" disabled={busy || small} onClick={() => void run(() => landUse(h.id, u.id), () => t('land.useStarted', { name: localName(u, i18n.language) })).then(onChanged)}>
                    <span aria-hidden="true">{u.emoji}</span>
                    <span className="ld-use-text">
                      <b>
                        {localName(u, i18n.language)}
                        {u.model && <span className="ld-class">{t(`housing.${u.model}`)}</span>}
                      </b>
                      {desc && <small className="ld-use-desc">{desc}</small>}
                      <small>
                        {small
                          ? t('land.useTooSmall', { min: u.minM2 })
                          : u.kind === 'HOUSE'
                            ? t('land.useHouse', { cost: fcfa(useCostFor(u)), days: u.buildGameDays })
                            : t('land.useBiz', { cost: fcfa(useCostFor(u)), days: u.buildGameDays, rate: pct(u.dailyYieldBp), life: u.lifeGameDays })}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {h.use && use && (
        <div className="ld-using">
          <strong>{use.emoji} {localName(use, i18n.language)}</strong>
          {!h.use.ready ? (
            <p className="ld-wip">🏗️ {t('land.siteWip', { time: gameDuration(useLeft) })}</p>
          ) : use.kind === 'BUSINESS' ? (
            <button className="btn primary" disabled={busy || BigInt(h.use.collectable) <= 0n} onClick={() => void run(() => landCollect(h.id), (r) => (BigInt(r.result.received) > 0n ? t('land.collected', { amount: fcfa(r.result.received) }) : null)).then(onChanged)}>
              💰 {t('land.collect', { amount: fcfa(h.use.collectable) })}
            </button>
          ) : h.use.movedIn ? (
            <p className="ok">🏠 {t('land.livingHere')}</p>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void run(() => landMoveIn(h.id), () => t('land.movedIn')).then(onChanged)}>
              🔑 {t('land.moveIn')}
            </button>
          )}
        </div>
      )}

      {h.status === 'TITLED' && !h.use?.movedIn && (
        <div className="ld-sell">
          {h.ask ? (
            <>
              <p>🏷️ {t('land.listedAt', { price: fcfa(h.ask) })}</p>
              <button className="btn" disabled={busy} onClick={() => void run(() => landUnlist(h.id), () => t('land.unlisted')).then(onChanged)}>{t('land.unlist')}</button>
            </>
          ) : (
            <>
              <label className="field">
                <span>{t('land.askLabel')}</span>
                <input type="text" inputMode="numeric" autoComplete="off" value={ask.toLocaleString(i18n.language)} onChange={(e) => setAsk(Math.max(1, Number(e.target.value.replace(/\D/g, '').slice(0, 13)) || 1))} />
              </label>
              <AccountGate big={false}>
                <button className="btn" disabled={busy} onClick={() => void run(() => landList(h.id, ask), () => t('land.listed')).then(onChanged)}>🏷️ {t('land.list')}</button>
              </AccountGate>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Marché : terrains en vente par les joueurs ----------

function MarketTab({ cat, onChanged }: { cat: LandCatalog; onChanged: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useGame();
  const [rows, setRows] = useState<LandListing[] | null>(null);
  const load = useCallback(async () => {
    const r = await run(getLandMarket);
    if (r) setRows(r.listings);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);
  const zoneName = (id: string) => {
    const z = cat.zones.find((x) => x.id === id);
    return z ? localName(z, i18n.language) : id;
  };
  if (!rows) return <p className="muted">{t('app.loading')}</p>;
  if (rows.length === 0) return <p className="muted">{t('land.marketEmpty')}</p>;
  return (
    <div className="ld-mine">
      <p className="muted small-line">{t('land.marketHint', { pct: pct(cat.transferTaxBp) })}</p>
      {rows.map((l) => {
        const ask = BigInt(l.ask);
        const tax = (ask * BigInt(cat.transferTaxBp)) / 10_000n;
        const dear = BigInt(l.askPerM2) > BigInt(l.marketPerM2);
        return (
          <div key={l.id} className="panel ld-holding">
            <div className="row-between">
              <strong>{zoneName(l.zoneId)} · {t('land.cell', { n: l.cell + 1 })}</strong>
              <b>{l.m2} m²</b>
            </div>
            <small className="muted">📜 {l.titleNo} · {t('land.seller', { name: l.seller })}</small>
            <div className="ld-ask">
              <b>{fcfa(l.ask)}</b>
              <span className={dear ? 'bad' : 'ok'}>{t('land.askPerM2', { ask: fcfa(l.askPerM2), market: fcfa(l.marketPerM2) })}</span>
            </div>
            {l.use && <small>{t(l.use.ready ? 'land.withSite' : 'land.withSiteWip')}</small>}
            {l.mine ? (
              <small className="muted">{t('land.yourListing')}</small>
            ) : (
              <AccountGate>
                <button className="btn primary" disabled={busy} onClick={() => void run(() => landBuyListing(l.id), () => t('land.boughtListing', { m2: l.m2 })).then(async () => (await Promise.all([load(), onChanged()]), undefined))}>
                  {t('land.buyListing', { total: fcfa(ask + tax) })}
                  <small>{t('land.buyListingTax', { tax: fcfa(tax) })}</small>
                </button>
              </AccountGate>
            )}
          </div>
        );
      })}
    </div>
  );
}
