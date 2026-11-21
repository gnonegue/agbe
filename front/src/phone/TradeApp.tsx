import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTrade, tradeBuy, tradeSell, type TradeGood } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import { matches } from '../lib/search';
import { setTradeFocus, tradeFocusGood } from '../lib/tradeFocus';
import QtyInput from '../ui/QtyInput';

/**
 * Commerce : comme à la Bourse, on choisit un article, la quantité, on achète puis on revend. Depuis le téléphone,
 * on achète au prix du jour et on revend au cours de rachat (un peu plus bas) ; la grosse marge s'obtient en allant
 * revendre sur place (port, marché). Les voitures s'achètent et se revendent sur place seulement.
 */
export default function TradeApp() {
  const { t, i18n } = useTranslation();
  const { run, busy, state, goTo, catalog } = useGame();
  const [goods, setGoods] = useState<TradeGood[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  // Deux onglets : acheter (catalogue) et mon stock (ce que j'ai acheté, à revendre)
  const [tab, setTab] = useState<'buy' | 'stock'>('buy');
  const tabSet = useRef(false);
  const [focus] = useState(() => tradeFocusGood());
  const focusRef = useRef<HTMLLIElement | null>(null);
  const load = useCallback(async () => {
    const r = await run(getTrade);
    if (r) setGoods(r.goods);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load, state.gameTime.day]);
  // Article choisi (bonne affaire, trajet) : amené à l'écran une fois la liste chargée
  useEffect(() => {
    // Article suivi vers son lieu de revente : on ouvre directement le stock
    if (goods && !tabSet.current) {
      tabSet.current = true;
      const g = goods.find((x) => x.id === focus);
      if (g && g.held > 0 && state.location === g.sellAt) setTab('stock');
    }
    if (goods && focusRef.current) focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [goods]);
  if (!goods) return <p className="muted">{t('app.loading')}</p>;
  const place = (id: string) => localName(catalog?.venues.find((v) => v.id === id) ?? { nameFr: id, nameEn: id }, i18n.language);
  const pct = (bp: number) => `${(bp / 100).toLocaleString(i18n.language)} %`;
  // Recherche sans accents ni majuscules, sur le nom du produit et sur les lieux d'achat / de vente
  const shown = goods.filter((g) => (tab === 'buy' || g.held > 0) && matches(query, g.nameFr, g.nameEn, place(g.buyAt), place(g.sellAt)));
  const groups = ([
    ['import', shown.filter((g) => g.kind === 'IMPORT')],
    ['export', shown.filter((g) => g.kind === 'EXPORT')],
    ['local', shown.filter((g) => g.kind === 'LOCAL')],
    ['car', shown.filter((g) => g.kind === 'CAR')],
  ] as [string, TradeGood[]][]).filter(([, list]) => list.length > 0);
  // Article mis en avant en tête de son groupe
  for (const [, list] of groups) list.sort((a, b) => Number(b.id === focus) - Number(a.id === focus));

  const trip = (g: TradeGood, to: string) => {
    setTradeFocus(g.id, to);
    goTo(to);
  };

  return (
    <section className="trade">
      <div className="chat-tabs" role="tablist">
        {(['buy', 'stock'] as const).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(x)}>
            {x === 'buy' ? '🛒' : '📦'} {t(`trade.tabs.${x}`)}{x === 'stock' ? ` (${goods.filter((g) => g.held > 0).length})` : ''}
          </button>
        ))}
      </div>
      <p className="muted">{t(tab === 'buy' ? 'trade.intro2' : 'trade.stockIntro')}</p>
      <input type="search" className="catalog-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('trade.search')} aria-label={t('trade.search')} autoComplete="off" />
      {groups.length === 0 && <p className="muted">{t(tab === 'stock' && !query ? 'trade.stockEmpty' : 'trade.noResult')}</p>}
      {groups.map(([k, list]) => (
        <div key={k} className="panel">
          <strong>{t(`trade.groups.${k}`)}</strong>
          <ul className="list stacked">
            {list.map((g) => {
              const atBuy = state.location === g.buyAt;
              const atSell = state.location === g.sellAt;
              const canBuy = atBuy || g.remote;
              const room = g.maxQty - g.held;
              // Quantité choisie, bornée à ce qu'on peut acheter (place restante) ou vendre (stock)
              const top = Math.max(1, tab === 'buy' ? room : g.held);
              const n = Math.max(1, Math.min(qty[g.id] ?? 1, top));
              const set = (v: number) => setQty({ ...qty, [g.id]: Math.max(1, Math.min(top, v)) });
              const margin = g.sellToday - g.buyToday;
              // Gain ou perte estimé d'une vente : recette (moins la taxe à l'export au port) moins le prix de revient des unités vendues
              const avgCost = g.held > 0 ? Number(g.heldCost) / g.held : 0;
              const estimate = (unit: number, remoteSale: boolean) => {
                const gross = unit * n;
                const exportTax = g.kind === 'EXPORT' && !remoteSale ? Math.ceil((gross * g.taxBp) / 10_000) : 0;
                return Math.round(gross - exportTax - avgCost * n);
              };
              const est = (v: number) => (
                <em className={v >= 0 ? 'tc-est gain' : 'tc-est loss'}>{v >= 0 ? t('trade.act.estGain', { amount: fcfa(v) }) : t('trade.act.estLoss', { amount: fcfa(-v) })}</em>
              );
              const name = localName(g, i18n.language);
              const buy = (remote: boolean) =>
                void run(() => tradeBuy(g.id, n, remote), (r) => t('trade.bought', { qty: n, item: name, amount: fcfa(r.result.paid) })).then(load);
              const sell = (remote: boolean) =>
                void run(() => tradeSell(g.id, n, remote), (r) => t('trade.sold', { qty: n, item: name, amount: fcfa(r.result.received), profit: fcfa(r.result.profit ?? '0') })).then(load);
              return (
                <li key={g.id} ref={g.id === focus ? focusRef : undefined} className={g.id === focus ? 'tc focus' : 'tc'}>
                  <header className="tc-head">
                    <span className="tc-emoji" aria-hidden="true">{g.emoji}</span>
                    <div className="tc-title">
                      <strong>{name}</strong>
                      <div className="tc-tags">
                        <span className="tc-tag">{g.kind === 'LOCAL' ? t('trade.noDuty') : g.kind === 'EXPORT' ? t('trade.exportTax', { rate: pct(g.taxBp) }) : t('trade.duty', { rate: pct(g.taxBp) })}</span>
                        <span className={margin > 0 ? 'tc-tag gain' : 'tc-tag loss'}>{margin > 0 ? '▲' : '▼'} {t('trade.margin', { amount: fcfa(margin) })}</span>
                      </div>
                    </div>
                  </header>

                  <dl className="tc-prices">
                    <div>
                      <dt>{t('trade.priceBuy')}</dt>
                      <dd>{fcfa(g.buyToday)}</dd>
                      <small>{place(g.buyAt)}</small>
                    </div>
                    <div>
                      <dt>{t('trade.priceSell')}</dt>
                      <dd className="ok">{fcfa(g.sellToday)}</dd>
                      <small>{place(g.sellAt)}</small>
                    </div>
                    {g.remote && (
                      <div className="remote">
                        <dt>📱 {t('trade.priceRemote')}</dt>
                        <dd>{fcfa(g.remoteSell)}</dd>
                        <small>{t('trade.remoteBuyAt', { amount: fcfa(g.remoteBuy) })}</small>
                      </div>
                    )}
                  </dl>

                  {tab === 'stock' && (
                    <div className="tc-stock">
                      <span>📦 {t('trade.held', { qty: g.held, max: g.maxQty, cost: fcfa(g.heldCost) })}</span>
                      <span className={g.soldToday >= g.dailyMax ? 'warn' : ''}>{t('trade.dailyLimit', { sold: g.soldToday, max: g.dailyMax })}</span>
                    </div>
                  )}

                  {((tab === 'buy' && canBuy) || (tab === 'stock' && g.held > 0)) && (
                    <div className="tc-qty">
                      <span>{t('trade.qty')}</span>
                      <QtyInput value={n} max={top} onChange={set} label={t('trade.qty')} />
                      <button type="button" className="btn small ghost" onClick={() => set(top)}>{t('trade.max')}</button>
                    </div>
                  )}

                  {tab === 'buy' && (
                  <div className="tc-group">
                    <span className="tc-label">🛒 {t('trade.act.buyTitle')}</span>
                    <div className="tc-btns">
                      {atBuy ? (
                        <button className="tc-btn primary" disabled={busy || room < n} onClick={() => buy(false)}>
                          <b>{t('trade.act.buyHere')}</b>
                          <span className="tc-amt">{fcfa(g.buyToday * n)}</span>
                        </button>
                      ) : (
                        <button className="tc-btn" onClick={() => trip(g, g.buyAt)}>
                          <b>🗺️ {t('trade.act.goBuy')}</b>
                          <small>{place(g.buyAt)}</small>
                          <span className="tc-amt">{fcfa(g.buyToday * n)}</span>
                        </button>
                      )}
                      {g.remote && !atBuy && (
                        <button className="tc-btn primary" disabled={busy || room < n} onClick={() => buy(true)}>
                          <b>📱 {t('trade.act.buyRemote')}</b>
                          <span className="tc-amt">{fcfa(g.remoteBuy * n)}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  )}

                  {tab === 'stock' && (
                    <div className="tc-group">
                      <span className="tc-label">💰 {t('trade.act.sellTitle')}</span>
                      <div className="tc-btns">
                        {atSell ? (
                          <button className="tc-btn primary" disabled={busy || g.held < n || g.soldToday + n > g.dailyMax} onClick={() => sell(false)}>
                            <b>{t('trade.act.sellHere')}</b>
                            <span className="tc-amt">{fcfa(g.sellToday * n)}</span>
                            {est(estimate(g.sellToday, false))}
                          </button>
                        ) : (
                          <button className="tc-btn" onClick={() => trip(g, g.sellAt)}>
                            <b>🗺️ {t('trade.act.goSell')}</b>
                            <small>{place(g.sellAt)}</small>
                            <span className="tc-amt">{fcfa(g.sellToday * n)}</span>
                            {est(estimate(g.sellToday, false))}
                          </button>
                        )}
                        {g.remote && !atSell && (
                          <button className="tc-btn" disabled={busy || g.held < n || g.soldToday + n > g.dailyMax} onClick={() => sell(true)}>
                            <b>📱 {t('trade.act.sellRemote')}</b>
                            <small>{t('trade.act.remoteNote')}</small>
                            <span className="tc-amt">{fcfa(g.remoteSell * n)}</span>
                            {est(estimate(g.remoteSell, true))}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
