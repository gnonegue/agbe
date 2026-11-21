import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buyEquipment, buyHome, moveHousing, payBill, payRent, payRentDebt } from '../api/endpoints';
import type { Bill } from '../api/types';
import { fcfa } from '../lib/format';
import HousingPicture from '../ui/HousingPicture';
import { useGame } from './ctx';
import { consumeFocusSection } from '../lib/focus';

type Tab = 'loyer' | 'factures' | 'autre';
const TAB_ICON: Record<Tab, string> = { loyer: '🏠', factures: '⚡', autre: '🔌' };

/** Factures CEET, TdE et wifi : montant et échéance donnés par le serveur. */
function Bills() {
  const { t } = useTranslation();
  const { state, run, busy } = useGame();
  return (
    <>
      <h2>{t('bills.title')}</h2>
      <p className="muted">{t('bills.hint')}</p>
      {(['ELEC', 'WATER', 'WIFI'] as Bill[]).map((b) => {
        const x = state.bills[b];
        const none = b === 'WIFI' && !x.active;
        return (
          <div key={b} className={`panel ${x.overdue ? 'danger' : ''}`}>
            <strong>{t(`bills.${b}`)}</strong>
            <p>{t('bills.monthly', { amount: fcfa(x.monthly) })}</p>
            {x.power && (
              // Électricité selon le contexte : logement, appareils installés, cuissons au réchaud électrique, panneaux solaires, tranches
              <div className="bill-power">
                <p>⚡ {t('bills.powerKwh', { kwh: x.power.kwh, energy: fcfa(x.power.energy), sub: fcfa(x.power.subscription) })}</p>
                <small className="muted">
                  {t('bills.powerBase', { kwh: x.power.baseKwh })}
                  {x.power.appliancesKwh > 0 ? ` · ${t('bills.powerAppliances', { kwh: x.power.appliancesKwh, n: x.power.appliances.length })}` : ''}
                  {x.power.cookingKwh > 0 ? ` · ${t('bills.powerCooking', { kwh: x.power.cookingKwh })}` : ''}
                  {x.power.solarKwh > 0 ? ` · ☀️ ${t('bills.powerSolar', { kwh: x.power.solarKwh })}` : ''}
                </small>
                <small className="muted">{t('bills.powerTranches')}</small>
              </div>
            )}
            {x.water && (
              // Eau selon l'usage : besoins du logement, douches et cuisine depuis la dernière facture, par tranches de m³
              <div className="bill-power">
                <p>💧 {t('bills.waterM3', { m3: (x.water.litres / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }), water: fcfa(x.water.water), sub: fcfa(x.water.subscription) })}</p>
                <small className="muted">
                  {t('bills.waterShowers', { n: x.usage?.showers ?? 0, m3: (x.water.showerLitres / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) })}
                </small>
                <small className="muted">{t('bills.waterTranches')}</small>
              </div>
            )}
            {x.overdue && (x.daysLate ?? 0) > 0 && <p className="error">{t('bills.lateFee', { days: x.daysLate, fee: state.rent.lateFeeBpPerDay / 100, amount: fcfa(x.due ?? x.monthly) })}</p>}
            <p className={x.overdue ? 'error' : none ? 'muted' : 'ok'}>
              {x.overdue ? t('bills.overdue') : none ? t('bills.wifiNone') : `${t('bills.ok')} · ${t('bills.until', { day: x.paidUntilGameDay })}`}
            </p>
            <button
              className={`btn big ${x.overdue ? 'primary' : ''}`}
              disabled={busy || BigInt(state.wallet.balance) < BigInt(x.due ?? x.monthly)}
              onClick={() => void run(() => payBill(b), (res) => t('bills.paid', { amount: fcfa(res.result.paid ?? x.monthly) }))}
            >
              {none ? t('bills.subscribe', { amount: fcfa(x.monthly) }) : t('bills.pay', { amount: fcfa(x.due ?? x.monthly) })}
            </button>
          </div>
        );
      })}
    </>
  );
}

/** Logements proposés : dessin, loyer, caution, prix d'achat ; emménager rend l'ancienne caution. */
function Offers() {
  const { t } = useTranslation();
  const { state, run, busy } = useGame();
  const r = state.rent;
  const blocked = r.owned || BigInt(r.debt) > 0n || (!r.homeless && r.overdue);
  return (
    <>
      <h2>{t('rent.offersTitle')}</h2>
      <p className="muted">{blocked && !r.owned ? t('rent.offersBlocked') : t('rent.offersHint')}</p>
      <div className="housing-list">
        {r.offers.map((o) => {
          const here = !r.homeless && o.housing === state.housing;
          const cost = BigInt(o.deposit + o.monthly) - (r.homeless ? 0n : BigInt(r.deposit));
          return (
            <div key={o.housing} className={`panel housing-card${here ? ' current' : ''}`}>
              <HousingPicture housing={o.housing} />
              <strong>{t(`housing.${o.housing}`)}</strong>
              <small className="muted">{t(`rent.desc.${o.housing}`)}</small>
              <p>{t('rent.perMonth', { amount: fcfa(o.monthly) })}</p>
              <small>{t('rent.depositLine', { amount: fcfa(o.deposit) })} · {t('rent.priceLine', { amount: fcfa(o.price) })}</small>
              {here ? (
                <p className="ok">🏠 {t('rent.current')}</p>
              ) : (
                !r.owned && (
                  <button
                    className="btn big"
                    disabled={busy || blocked || BigInt(state.wallet.balance) < cost}
                    onClick={() => void run(() => moveHousing(o.housing), () => t('rent.moved', { housing: t(`housing.${o.housing}`) }))}
                  >
                    {cost >= 0n ? t('rent.moveIn', { amount: fcfa(cost) }) : t('rent.moveInRefund', { amount: fcfa(-cost) })}
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function RentApp() {
  const { t } = useTranslation();
  const { state, run, busy } = useGame();
  const r = state.rent;
  const debt = BigInt(r.debt);
  // Section demandée par une notification (facture, coupure) : choisit l'onglet d'ouverture, une seule fois.
  const [tab, setTab] = useState<Tab>(() => {
    const id = consumeFocusSection();
    return id === 'bills' ? 'factures' : id === 'outages' ? 'autre' : 'loyer';
  });
  return (
    <section>
      <div className="chat-tabs" role="tablist">
        {(['loyer', 'factures', 'autre'] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(x)}>
            {TAB_ICON[x]} {t(`rent.tabs.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'loyer' && (
        <>
          {debt > 0n && (
            <div className="panel danger">
              <strong>💸 {t('rent.debtTitle')}</strong>
              <p>{t('rent.debtText', { amount: fcfa(r.debt) })}</p>
              <button className="btn primary big" disabled={busy || BigInt(state.wallet.balance) <= 0n} onClick={() => void run(payRentDebt, (res) => t('rent.debtPaid', { amount: fcfa(res.result.paid) }))}>
                {t('rent.debtPay')}
              </button>
            </div>
          )}
          {r.homeless ? (
            <div className="panel danger">
              <strong>🛌 {t('rent.homelessTitle')}</strong>
              <p>{t('rent.homelessText')}</p>
            </div>
          ) : r.owned ? (
            <div className="panel">
              <HousingPicture housing={state.housing} />
              <p>
                {t('rent.housing')} <strong>{t(`housing.${state.housing}`)}</strong>
              </p>
              <p className="ok">🔑 {t('rent.owner')}</p>
            </div>
          ) : (
            <div className={`panel ${r.overdue ? 'danger' : ''}`}>
              <HousingPicture housing={state.housing} />
              <p>
                {t('rent.housing')} <strong>{t(`housing.${state.housing}`)}</strong>
              </p>
              <p>
                {t('rent.monthly')} <strong>{fcfa(r.monthly)}</strong>
              </p>
              <p>{t('rent.paidUntil', { day: r.paidUntilGameDay })}</p>
              <p className="muted">{t('rent.today', { day: state.gameTime.day })}</p>
              {r.overdue ? (
                <>
                  <p className="error">{t('rent.overdueMonths', { count: r.overdueMonths, days: r.overdueDays ?? 0, fee: r.lateFeeBpPerDay / 100, amount: fcfa(r.nextPayment) })}</p>
                  <p className="error">{(r.evictInDays ?? 0) > 0 ? t('rent.evictIn', { count: r.evictInDays ?? 0 }) : t('rent.evictNow')}</p>
                </>
              ) : (
                <p className="ok">{t('rent.ok')}</p>
              )}
              {BigInt(r.deposit) > 0n && <small className="muted">{t('rent.depositHeld', { amount: fcfa(r.deposit) })}</small>}
              <button
                className="btn primary big"
                disabled={busy || BigInt(state.wallet.balance) < BigInt(r.nextPayment)}
                onClick={() => void run(payRent, (res) => t('rent.paid', { amount: fcfa(res.result.paid ?? r.monthly) }))}
              >
                {t('rent.pay', { amount: fcfa(r.nextPayment) })}
              </button>
            </div>
          )}
          {!r.owned && !r.homeless && r.price > 0 && (
            <div className="panel">
              <strong>🏡 {t('rent.buyTitle')}</strong>
              <small className="muted">{t('rent.buyText', { price: fcfa(r.price), months: Math.round(r.price / Math.max(1, r.monthly)) })}</small>
              <button
                className="btn big"
                disabled={busy || r.overdue || debt > 0n || BigInt(state.wallet.balance) + BigInt(r.deposit) < BigInt(r.price)}
                onClick={() => void run(buyHome, () => t('rent.bought', { price: fcfa(r.price) }))}
              >
                {t('rent.buy', { price: fcfa(r.price) })}
              </button>
            </div>
          )}
          <Offers />
        </>
      )}
      {tab === 'factures' && !r.homeless && <Bills />}
      {tab === 'autre' && !r.homeless && <Equipment />}
    </section>
  );
}

/** Coupures d'électricité et d'eau : état du jour et équipements qui protègent (achat unique, prix fixé par le serveur). */
function Equipment() {
  const { t } = useTranslation();
  const { state, catalog, run, busy } = useGame();
  const o = state.outages;
  const eq = state.equipment;
  const prices = catalog?.outages;
  if (!eq || !prices) return null;
  const items = [
    { kind: 'generator' as const, icon: '⛽', price: prices.generatorPrice, owned: eq.generator },
    { kind: 'solar' as const, icon: '☀️', price: prices.solarPrice, owned: eq.solar },
    { kind: 'waterTank' as const, icon: '🛢️', price: prices.tankPrice, owned: eq.waterTank },
  ];
  const balance = BigInt(state.wallet.balance);
  const until = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <div className="panel">
      <h3>🔌 {t('outage.title')}</h3>
      {o?.power && <p className="warning">💡 {t('outage.power', { until: until(o.powerUntil) })}{eq.generator || eq.solar ? ` · ${t('outage.covered')}` : ''}</p>}
      {o?.water && <p className="warning">🚱 {t('outage.water', { until: until(o.waterUntil) })}{eq.waterTank ? ` · ${t('outage.covered')}` : ''}</p>}
      {!o?.power && !o?.water && <p className="ok">{t('outage.none')}</p>}
      <ul className="list">
        {items.map((i) => (
          <li key={i.kind} className="item">
            <div className="item-main">
              <strong>{i.icon} {t(`outage.items.${i.kind}.name`)}</strong>
              <small>{t(`outage.items.${i.kind}.hint`)}</small>
            </div>
            {i.owned ? (
              <span className="ok">✓ {t('outage.owned')}</span>
            ) : (
              <button className="btn small" disabled={busy || balance < BigInt(i.price)} onClick={() => void run(() => buyEquipment(i.kind), () => t('outage.bought'))}>
                {fcfa(i.price)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
