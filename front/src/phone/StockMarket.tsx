import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buyStock, getStockHistory, sellStock, type StockHistory, type StockInfo, type StockRange } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import QtyInput from '../ui/QtyInput';
import { useSubBack } from './subBack';

const RANGES: StockRange[] = ['1d', '7d', '30d', '90d', '1y', '5y'];
type Sort = 'default' | 'up' | 'down' | 'mine';

/** Sans accents ni majuscules, pour la recherche. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Prix d'achat moyen d'une action (frais compris), arrondi au franc. */
const unitCost = (s: StockInfo) => (s.held > 0 ? Math.round(Number(s.heldCost) / s.held) : 0);

/** Mini-graphique des 14 derniers jours. */
function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${30 - ((v - min) / Math.max(1, max - min)) * 28 - 1}`).join(' ');
  const up = data[data.length - 1]! >= data[0]!;
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? '#16a34a' : '#dc2626'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Graphique d'une période : cours, moyenne de la période, prix d'achat moyen ; toucher ou survoler pour lire un point. */
function Chart({ h, cost }: { h: StockHistory; cost: number }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 170;
  const padL = 6;
  const padR = 58;
  const padT = 12;
  const padB = 20;
  const pts = h.points;
  const lo = Math.min(h.min, cost > 0 ? cost : h.min);
  const hi = Math.max(h.max, cost > 0 ? cost : h.max);
  const span = Math.max(1, hi - lo);
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  const x = (tt: number) => padL + ((tt - t0) / Math.max(1e-9, t1 - t0)) * (W - padL - padR);
  const y = (p: number) => padT + (1 - (p - lo) / span) * (H - padT - padB);
  const line = pts.map((q) => `${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1]!.p >= pts[0]!.p;
  const color = up ? '#16a34a' : '#dc2626';
  const area = `${padL},${H - padB} ${line} ${x(t1).toFixed(1)},${H - padB}`;
  const sel = hover === null ? null : pts[hover]!;
  const when = (tt: number) => t('invest.when', { day: Math.floor(tt) + 1, hour: String(Math.round((tt % 1) * 24) % 24).padStart(2, '0') });
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const rel = Math.min(1, Math.max(0, (vx - padL) / (W - padL - padR)));
    setHover(Math.round(rel * (pts.length - 1)));
  };
  const label = (p: number, cls: string, txt: string) => (
    <text x={W - padR + 4} y={Math.min(H - padB, Math.max(padT + 4, y(p) + 3))} className={cls}>
      {txt}
    </text>
  );
  return (
    <div className="stock-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('invest.chartLabel', { min: fcfa(h.min), max: fcfa(h.max) })} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="stock-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} className="grid" />
        ))}
        <polygon points={area} fill="url(#stock-fill)" />
        <line x1={padL} x2={W - padR} y1={y(h.avg)} y2={y(h.avg)} className="avg" />
        {cost > 0 && <line x1={padL} x2={W - padR} y1={y(cost)} y2={y(cost)} className="cost" />}
        <polyline points={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(t1)} cy={y(pts[pts.length - 1]!.p)} r="3.5" fill={color} />
        {label(h.max, 'lbl', fcfa(h.max))}
        {label(h.min, 'lbl', fcfa(h.min))}
        {cost > 0 && label(cost, 'lbl cost-lbl', t('invest.costShort'))}
        <text x={padL} y={H - 5} className="axis">
          {when(t0)}
        </text>
        <text x={W - padR} y={H - 5} className="axis" textAnchor="end">
          {t('invest.now')}
        </text>
        {sel && (
          <g>
            <line x1={x(sel.t)} x2={x(sel.t)} y1={padT} y2={H - padB} className="cursor" />
            <circle cx={x(sel.t)} cy={y(sel.p)} r="4" fill="#fff" stroke={color} strokeWidth="2" />
          </g>
        )}
      </svg>
      <div className="stock-chart-legend">
        {sel ? (
          <b>
            {when(sel.t)} · {fcfa(sel.p)}
          </b>
        ) : (
          <>
            <span className="lg avg">{t('invest.avgLine', { price: fcfa(h.avg) })}</span>
            {cost > 0 && <span className="lg cost">{t('invest.costLine', { price: fcfa(cost) })}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** Bourse : liste avec recherche et tri, puis fiche d'une action (graphique par période, repères, achat et vente). */
export default function StockMarket({ stocks, feeBp, balance, reload }: { stocks: StockInfo[]; feeBp: number; balance: bigint; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useGame();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('default');
  const [open, setOpen] = useState<string | null>(null);
  const [range, setRange] = useState<StockRange>('30d');
  const [hist, setHist] = useState<StockHistory | null>(null);
  const [histFailed, setHistFailed] = useState(false);
  const [qty, setQty] = useState(1);
  const en = i18n.language.startsWith('en');
  const pct = (bp: number) => `${bp > 0 ? '+' : ''}${(bp / 100).toLocaleString(i18n.language, { maximumFractionDigits: 2 })} %`;
  const stock = stocks.find((s) => s.symbol === open) ?? null;
  // Flèche du téléphone et bouton retour : de la fiche d'une action vers la liste
  useSubBack(stock ? () => setOpen(null) : null);

  const list = useMemo(() => {
    const q = fold(query.trim());
    const out = stocks.filter((s) => !q || fold(`${s.symbol} ${s.nameFr} ${s.nameEn} ${s.sectorFr} ${s.sectorEn}`).includes(q));
    if (sort === 'up') out.sort((a, b) => b.changeBp - a.changeBp);
    if (sort === 'down') out.sort((a, b) => a.changeBp - b.changeBp);
    if (sort === 'mine') return out.filter((s) => s.held > 0);
    return out;
  }, [stocks, query, sort]);

  // Historique de l'action ouverte, rechargé avec le cours (chaque heure de jeu) et au changement de période
  const price = stock?.price;
  useEffect(() => {
    if (!open) return;
    let off = false;
    setHistFailed(false);
    getStockHistory(open, range).then(
      (h) => !off && setHist(h),
      () => !off && setHistFailed(true),
    );
    return () => {
      off = true;
    };
  }, [open, range, price]);

  if (stock) {
    const cost = unitCost(stock);
    const h = hist && hist.symbol === stock.symbol && hist.range === range ? hist : null;
    const n = Math.max(1, qty);
    const gainBp = cost > 0 ? Math.round(((stock.price - cost) * 10_000) / cost) : 0;
    // Repères de lecture : position du cours dans la fourchette de la période et tendance (début contre fin de période)
    let zone: 'low' | 'mid' | 'high' = 'mid';
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (h && h.max > h.min) {
      const pos = (stock.price - h.min) / (h.max - h.min);
      zone = pos <= 0.25 ? 'low' : pos >= 0.75 ? 'high' : 'mid';
      const third = Math.max(1, Math.floor(h.points.length / 3));
      const mean = (a: { p: number }[]) => a.reduce((s, q) => s + q.p, 0) / a.length;
      const r = mean(h.points.slice(-third)) / mean(h.points.slice(0, third)) - 1;
      trend = r > 0.02 ? 'up' : r < -0.02 ? 'down' : 'flat';
    }
    const agit = stock.volBp < 200 ? 'calm' : stock.volBp < 320 ? 'medium' : 'wild';
    return (
      <div className="stock-detail">
        <button className="btn small stock-back" onClick={() => setOpen(null)}>
          ‹ {t('invest.backList')}
        </button>
        <div className="stock-head">
          <div>
            <strong>
              {stock.symbol} · {localName(stock, i18n.language)}
            </strong>
            <small className="muted">
              {en ? stock.sectorEn : stock.sectorFr} · {t(`invest.agit.${agit}`)}
            </small>
          </div>
          <div className="stock-price">
            <b>{fcfa(stock.price)}</b>
            <span className={stock.changeBp >= 0 ? 'ok' : 'bad'}>{t('invest.change24', { pct: pct(stock.changeBp) })}</span>
          </div>
        </div>

        <div className="look-chips stock-ranges" role="tablist" aria-label={t('invest.period')}>
          {RANGES.map((r) => (
            <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'look-chip on' : 'look-chip'} onClick={() => setRange(r)}>
              {t(`invest.ranges.${r}`)}
            </button>
          ))}
        </div>

        {h ? <Chart h={h} cost={cost} /> : histFailed ? <p className="muted">{t('app.loadFailed')}</p> : <div className="stock-chart loading" aria-busy="true" />}

        {h && (
          <>
            <div className="stock-stats">
              <div>
                <small>{t('invest.statChange')}</small>
                <b className={h.changeBp >= 0 ? 'ok' : 'bad'}>{pct(h.changeBp)}</b>
              </div>
              <div>
                <small>{t('invest.statHigh')}</small>
                <b>{fcfa(h.max)}</b>
              </div>
              <div>
                <small>{t('invest.statLow')}</small>
                <b>{fcfa(h.min)}</b>
              </div>
              <div>
                <small>{t('invest.statAvg')}</small>
                <b>{fcfa(h.avg)}</b>
              </div>
            </div>
            <div className={`stock-hint ${zone}`}>
              <p>{t(`invest.zone.${zone}`, { period: t(`invest.rangesLong.${range}`) })}</p>
              <p>{t(`invest.trend.${trend}`)}</p>
              <small className="muted">{t('invest.hintNote')}</small>
            </div>
          </>
        )}

        {stock.held > 0 && (
          <div className="stock-mine">
            <div>
              <small>{t('invest.mineQty')}</small>
              <b>{stock.held.toLocaleString(i18n.language)}</b>
            </div>
            <div>
              <small>{t('invest.mineUnit')}</small>
              <b>{fcfa(cost)}</b>
            </div>
            <div>
              <small>{t('invest.mineNow')}</small>
              <b>{fcfa(stock.price)}</b>
            </div>
            <div>
              <small>{t('invest.mineResult')}</small>
              <b className={gainBp >= 0 ? 'ok' : 'bad'}>
                {pct(gainBp)} · {fcfa(stock.held * stock.price - Number(stock.heldCost))}
              </b>
            </div>
          </div>
        )}

        <div className="qty-row">
          <span>{t('trade.qty')}</span>
          <QtyInput value={n} max={10000} onChange={setQty} label={t('trade.qty')} />
          <small className="muted">{t('invest.total', { amount: fcfa(stock.price * n) })}</small>
        </div>
        <div className="row-between">
          <button className="btn primary" disabled={busy || balance < BigInt(stock.price * n)} onClick={() => void run(() => buyStock(stock.symbol, n), (r) => t('invest.bought', { qty: n, symbol: stock.symbol, amount: fcfa(r.result.paid) })).then(reload)}>
            {t('invest.buy')}
          </button>
          <button className="btn" disabled={busy || stock.held < n} onClick={() => void run(() => sellStock(stock.symbol, n), (r) => t('invest.sold', { qty: n, symbol: stock.symbol, amount: fcfa(r.result.received), profit: fcfa(r.result.profit ?? '0') })).then(reload)}>
            {t('invest.sell')}
          </button>
        </div>
        <small className="muted">{t('invest.fee', { rate: pct(feeBp).replace('+', '') })}</small>
      </div>
    );
  }

  return (
    <div>
      <input type="search" className="catalog-search decor-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('invest.search')} aria-label={t('invest.search')} autoComplete="off" />
      <div className="look-chips stock-sort" role="tablist" aria-label={t('invest.sortLabel')}>
        {(['default', 'up', 'down', 'mine'] as Sort[]).map((k) => (
          <button key={k} role="tab" aria-selected={sort === k} className={sort === k ? 'look-chip on' : 'look-chip'} onClick={() => setSort(k)}>
            {t(`invest.sort.${k}`)}
          </button>
        ))}
      </div>
      <ul className="list stacked">
        {list.length === 0 && <li className="muted">{t(sort === 'mine' && !query ? 'invest.noneHeld' : 'invest.noMatch')}</li>}
        {list.map((s) => {
          const cost = unitCost(s);
          return (
            <li key={s.symbol} className="item">
              <button
                className="stock-row"
                onClick={() => {
                  setOpen(s.symbol);
                  setHist(null);
                  setQty(1);
                }}
                aria-label={t('invest.openStock', { name: localName(s, i18n.language) })}
              >
                <span className="stock-row-main">
                  <strong>
                    {s.symbol} · {localName(s, i18n.language)}
                  </strong>
                  <small className="muted">{en ? s.sectorEn : s.sectorFr}</small>
                </span>
                <span className="stock-row-price">
                  <b>{fcfa(s.price)}</b>
                  <span className={s.changeBp >= 0 ? 'ok' : 'bad'}>{pct(s.changeBp)}</span>
                </span>
                <Spark data={s.series} />
                {s.held > 0 && (
                  <small className={s.price >= cost ? 'ok stock-row-held' : 'bad stock-row-held'}>
                    {t('invest.heldUnit', { qty: s.held, cost: fcfa(cost), price: fcfa(s.price), pct: pct(Math.round(((s.price - cost) * 10_000) / Math.max(1, cost))) })}
                  </small>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <small className="muted">{t('invest.fee', { rate: pct(feeBp).replace('+', '') })}</small>
    </div>
  );
}
