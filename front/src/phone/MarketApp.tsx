import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buyAtStall, buyWholesale, getMyMarket, getStalls, rentStall, setStallPrice, useGood, withdrawStock } from '../api/endpoints';
import type { MarketGood, MarketStalls, MyMarket } from '../api/types';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import QtyInput from '../ui/QtyInput';

/** Marché entre joueurs : son étal (gros, prix, stock), les étals des autres et son panier. */
export default function MarketApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy, goTo } = useGame();
  const [mine, setMine] = useState<MyMarket | null>(null);
  const [stalls, setStalls] = useState<MarketStalls | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([run(getMyMarket), run(getStalls)]);
    if (m) setMine(m);
    if (s) setStalls(s);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load, state.location]);

  if (!catalog || !mine) return <p className="muted">{t('app.loading')}</p>;
  const { goods, rules } = catalog.market;
  const good = (id: string): MarketGood | undefined => goods.find((g) => g.id === id);
  const gname = (id: string) => {
    const g = good(id);
    return g ? localName(g, i18n.language) : id;
  };
  const gemoji = (id: string) => good(id)?.emoji ?? '🧺';
  const venueName = (id: string) => {
    const v = catalog.venues.find((x) => x.id === id);
    return v ? localName(v, i18n.language) : id;
  };
  const atMarket = rules.venues.includes(state.location);
  // Marchés de la ville où se trouve le joueur seulement (chaque ville a le sien).
  const myMarkets = rules.venues.filter((id) => catalog.venues.find((v) => v.id === id)?.city === (state.city ?? 'lome'));
  const balance = BigInt(state.wallet.balance);
  const q = (k: string) => qty[k] ?? 1;
  const after = <T,>(p: Promise<T | null>) => void p.then(load);
  const effects = (g: MarketGood) =>
    Object.entries(g.effects)
      .map(([k, v]) => `${v! > 0 ? '+' : ''}${v} ${t(`needs.${k}`)}`)
      .join(' · ');
  const st = mine.stall;

  return (
    <section>
      <p className="muted">{t('market.intro')}</p>
      {!atMarket && (
        <div className="panel">
          <p className="warning">{t('market.goToMarket')}</p>
          <div className="row-actions">
            {myMarkets.map((v) => (
              <button key={v} className="btn small" onClick={() => goTo(v)}>🗺️ {venueName(v)}</button>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h3>🧺 {t('market.myStall')}</h3>
        {st ? (
          <>
            <p className={st.open ? 'ok' : 'warning'}>
              {st.open ? t('market.stallOpen', { place: venueName(st.venueId), day: st.paidUntilDay }) : t('market.stallExpired', { place: venueName(st.venueId) })}
            </p>
            <p className="small-line">
              {t(`market.ranks.${st.rank.id}`)} · {t('market.sales', { amount: fcfa(st.sales) })}
              {st.rank.next && <> · {t('market.nextRank', { rank: t(`market.ranks.${st.rank.next.id}`), amount: fcfa(st.rank.next.minSales) })}</>}
            </p>
          </>
        ) : (
          <p className="muted">{t('market.noStall', { rent: fcfa(rules.weeklyRent) })}</p>
        )}
        {atMarket && (
          <button className="btn primary" disabled={busy || balance < BigInt(rules.weeklyRent)} onClick={() => after(run(() => rentStall(1), (r) => t('market.rented', { day: r.result.paidUntilDay })))}>
            {st?.open ? t('market.extend', { rent: fcfa(rules.weeklyRent) }) : t('market.rent', { rent: fcfa(rules.weeklyRent) })}
          </button>
        )}
        {st && st.items.length > 0 && (
          <ul className="list">
            {st.items.map((i) => {
              const g = good(i.goodId);
              const max = g ? Math.floor((g.wholesale * g.maxMarkupBp + 5_000) / 10_000) : i.price; // même arrondi que le serveur
              return (
                <li key={i.goodId} className="item mkt-item">
                  <span className="mkt-ic" aria-hidden="true">{gemoji(i.goodId)}</span>
                  <div className="item-main">
                    <strong>{gname(i.goodId)}</strong>
                    <small>{t('market.stock', { n: i.qty })} · {t('market.priceNow', { price: fcfa(i.price) })}</small>
                    <span className="inline-edit">
                      <input inputMode="numeric" aria-label={t('market.newPrice')} placeholder={String(i.price)} value={prices[i.goodId] ?? ''} onChange={(e) => setPrices({ ...prices, [i.goodId]: e.target.value.replace(/\D/g, '') })} />
                      <button className="btn small" disabled={busy || !prices[i.goodId] || Number(prices[i.goodId]) > max} onClick={() => after(run(() => setStallPrice(i.goodId, Number(prices[i.goodId])), () => t('market.priceSet')))}>
                        {t('market.setPrice')}
                      </button>
                      <small className="muted">{t('market.maxPrice', { max: fcfa(max) })}</small>
                    </span>
                  </div>
                  <button className="btn small ghost" disabled={busy || i.qty < 1} onClick={() => after(run(() => withdrawStock(i.goodId, 1), () => t('market.withdrawn')))}>
                    {t('market.withdraw')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {st?.open && atMarket && (
          <>
            <h4>{t('market.wholesaleTitle')}</h4>
            <ul className="list">
              {goods.map((g) => {
                const unit = mine.wholesale[g.id] ?? g.wholesale;
                const k = `w:${g.id}`;
                return (
                  <li key={g.id} className="item mkt-item">
                    <span className="mkt-ic" aria-hidden="true">{gemoji(g.id)}</span>
                    <div className="item-main">
                      <strong>{gname(g.id)}</strong>
                      <small>{t('market.wholesaleUnit', { price: fcfa(unit) })}</small>
                    </div>
                    <QtyInput value={q(k)} max={rules.maxStock} onChange={(v) => setQty({ ...qty, [k]: v })} label={t('market.qty')} />
                    <button className="btn small" disabled={busy || balance < BigInt(unit * q(k))} onClick={() => after(run(() => buyWholesale(g.id, q(k)), (r) => t('market.bought', { paid: fcfa(r.result.paid) })))}>
                      {t('market.buyFor', { price: fcfa(unit * q(k)) })}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {atMarket && (
        <div className="panel">
          <h3>🛍️ {t('market.othersTitle', { place: venueName(state.location) })}</h3>
          {stalls && stalls.stalls.length === 0 && <p className="muted">{t('market.noOthers')}</p>}
          {stalls?.stalls.map((s) => (
            <div key={s.id} className="stall-card">
              <strong>{s.seller}</strong> <small className="muted">· {t(`market.ranks.${s.rank}`)}</small>
              <ul className="list">
                {s.items.map((i) => {
                  const k = `b:${s.id}:${i.goodId}`;
                  const n = Math.min(q(k), i.qty, rules.maxBuy);
                  return (
                    <li key={i.goodId} className="item mkt-item">
                      <span className="mkt-ic" aria-hidden="true">{gemoji(i.goodId)}</span>
                      <div className="item-main">
                        <strong>{gname(i.goodId)}</strong>
                        <small>{t('market.unitPrice', { price: fcfa(i.price) })} · {t('market.left', { n: i.qty })}</small>
                      </div>
                      <QtyInput value={n} max={Math.min(i.qty, rules.maxBuy)} onChange={(v) => setQty({ ...qty, [k]: v })} label={t('market.qty')} />
                      <button className="btn small primary" disabled={busy || balance < BigInt(i.price * n)} onClick={() => after(run(() => buyAtStall(s.id, i.goodId, n), (r) => t('market.bought', { paid: fcfa(r.result.paid) })))}>
                        {t('market.buyFor', { price: fcfa(i.price * n) })}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="muted small-line">{t('market.taxNote', { pct: rules.taxBp / 100 })}</p>
        </div>
      )}

      <div className="panel">
        <h3>🎒 {t('market.inventory')}</h3>
        {mine.inventory.length === 0 && <p className="muted">{t('market.emptyInventory')}</p>}
        <ul className="list">
          {mine.inventory.map((i) => {
            const g = good(i.goodId);
            return (
              <li key={i.goodId} className="item mkt-item">
                <span className="mkt-ic" aria-hidden="true">{gemoji(i.goodId)}</span>
                <div className="item-main">
                  <strong>{gname(i.goodId)} × {i.qty}</strong>
                  {g && <small>{effects(g)}</small>}
                </div>
                <button className="btn small" disabled={busy} onClick={() => after(run(() => useGood(i.goodId), () => t('market.used', { name: gname(i.goodId) })))}>
                  {t('market.use')}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
