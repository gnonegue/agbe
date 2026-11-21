import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buyVehicle, getGarage, refuelVehicle, repairVehicle, sellVehicle, serviceVehicle, type Garage, type MyVehicle, type VehicleModel } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import { nearestOf } from '../lib/nearest';

const litres = (ml: number) => (ml / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** Garage : concession (motos et voitures), carburant, entretien, réparations et revente. Les prix sont décidés par le serveur. */
export default function GarageApp() {
  const { t, i18n } = useTranslation();
  const { state, run, busy, goTo, catalog } = useGame();
  const [garage, setGarage] = useState<Garage | null>(null);
  const [tab, setTab] = useState<'mine' | 'shop'>('mine');
  const en = i18n.language === 'en';
  const load = useCallback(async () => {
    const g = await run(getGarage);
    if (g) setGarage(g);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load, state.wallet.balance, state.location]);
  if (!garage) return <p className="muted">{t('app.loading')}</p>;
  const atStation = garage.stations.includes(state.location);
  const model = (id: string) => garage.models.find((m) => m.id === id);
  const nearest = nearestOf(catalog, state, garage.stations);
  const stationVenues = (catalog?.venues ?? []).filter((v) => garage.stations.includes(v.id) && v.id !== state.location && (v.city ?? 'lome') === (state.city ?? 'lome'));

  const bar = (v: MyVehicle) => Math.round((v.fuelMl / Math.max(1, v.tankMl)) * 100);

  return (
    <section className="garage">
      <h2>{t('garage.title')}</h2>
      <div className="segmented">
        <button className={`seg ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>{t('garage.mine', { n: garage.mine.length, max: garage.maxVehicles })}</button>
        <button className={`seg ${tab === 'shop' ? 'active' : ''}`} onClick={() => setTab('shop')}>{t('garage.shop')}</button>
      </div>

      {tab === 'mine' && (
        <>
          {garage.mine.length === 0 && <p className="muted">{t('garage.none')}</p>}
          {!atStation && garage.mine.length > 0 && (
            <div className="panel">
              <p>{t('garage.needStation')}</p>
              {nearest && (
                <button className="btn primary" onClick={() => goTo(nearest.venue.id)}>
                  ⛽ {t('garage.goNearest', { name: localName(nearest.venue, i18n.language), km: nearest.km.toLocaleString(i18n.language, { maximumFractionDigits: 1 }) })}
                </button>
              )}
              <small className="muted">{t('garage.orChoose')}</small>
              <ul className="chips">
                {stationVenues.map((v) => (
                  <li key={v.id}>
                    <button className="chip-act" onClick={() => goTo(v.id)}>📍 {localName(v, i18n.language)}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {garage.mine.map((v) => {
            const m = model(v.modelId);
            const room = Math.floor((v.tankMl - v.fuelMl) / 1000);
            const repairPrice = m ? Math.ceil((m.repairCost * v.damage) / 100) : 0;
            return (
              <div key={v.id} className={`panel vehicle ${v.drivable ? '' : 'danger'}`}>
                <h3>{m?.emoji} {m ? localName(m, i18n.language) : v.modelId}</h3>
                <div className="gauge" title={t('garage.fuel')}>
                  <span>⛽ {t('garage.fuelOf', { now: litres(v.fuelMl), max: litres(v.tankMl) })}</span>
                  <div className="trip-track"><div className={`trip-fill ${bar(v) < 20 ? 'low' : ''}`} style={{ width: `${bar(v)}%` }} /></div>
                </div>
                <div className="gauge" title={t('garage.condition')}>
                  <span>🔧 {t('garage.conditionOf', { value: v.condition })}</span>
                  <div className="trip-track"><div className={`trip-fill ${v.condition < 40 ? 'low' : ''}`} style={{ width: `${v.condition}%` }} /></div>
                </div>
                <small className="muted">{t('garage.odometer', { km: v.odometerKm })} · {t('garage.sinceService', { km: v.sinceServiceKm, every: v.serviceEveryKm })}</small>
                {v.serviceDue && <p className="warning">⚠️ {t('garage.serviceDue', { risk: v.breakdownRiskBp / 100 })}</p>}
                {!v.drivable && <p className="error">🚫 {t('garage.needsRepair')}</p>}
                {atStation ? (
                  <div className="row-actions">
                    <button className="btn" disabled={busy || room < 1} onClick={() => void run(() => refuelVehicle(v.id, room), (r) => t('garage.refueled', { l: r.result.liters, price: fcfa(r.result.paid) })).then(load)}>
                      ⛽ {t('garage.fillUp', { price: fcfa(room * garage.fuelPricePerL) })}
                    </button>
                    <button className="btn" disabled={busy || room < 1} onClick={() => void run(() => refuelVehicle(v.id, Math.min(5, room)), (r) => t('garage.refueled', { l: r.result.liters, price: fcfa(r.result.paid) })).then(load)}>
                      ＋5 L ({fcfa(Math.min(5, room) * garage.fuelPricePerL)})
                    </button>
                    {v.sinceServiceKm >= 1 && (
                      <button className="btn" disabled={busy} onClick={() => void run(() => serviceVehicle(v.id), (r) => t('garage.serviced', { price: fcfa(r.result.paid) })).then(load)}>
                        🛠️ {t('garage.service', { price: fcfa(m?.serviceCost ?? 0) })}
                      </button>
                    )}
                    {v.damage > 0 && (
                      <button className="btn primary" disabled={busy} onClick={() => void run(() => repairVehicle(v.id), (r) => t('garage.repaired', { price: fcfa(r.result.paid) })).then(load)}>
                        🔩 {t('garage.repair', { price: fcfa(repairPrice) })}
                      </button>
                    )}
                  </div>
                ) : garage.remoteFuel ? (
                  // Loin d'une station (panne sèche en route) : on fait livrer le carburant, plus cher qu'à la pompe
                  <div className="remote-fuel">
                    <small className="muted">🚚 {t('garage.remoteInfo', { perL: fcfa(garage.remoteFuel.pricePerL), station: fcfa(garage.fuelPricePerL), fee: fcfa(garage.remoteFuel.fee) })}</small>
                    <div className="row-actions">
                      <button className="btn primary" disabled={busy || room < 1} onClick={() => void run(() => refuelVehicle(v.id, room, true), (r) => t('garage.remoteDone', { l: r.result.liters, price: fcfa(r.result.paid) })).then(load)}>
                        🚚 {t('garage.remoteFill', { price: fcfa(room * garage.remoteFuel.pricePerL + garage.remoteFuel.fee) })}
                      </button>
                      <button className="btn" disabled={busy || room < 1} onClick={() => void run(() => refuelVehicle(v.id, Math.min(5, room), true), (r) => t('garage.remoteDone', { l: r.result.liters, price: fcfa(r.result.paid) })).then(load)}>
                        ＋5 L ({fcfa(Math.min(5, room) * garage.remoteFuel.pricePerL + garage.remoteFuel.fee)})
                      </button>
                    </div>
                  </div>
                ) : null}
                <button className="btn ghost small" disabled={busy} onClick={() => void run(() => sellVehicle(v.id), (r) => t('garage.sold', { price: fcfa(r.result.received) })).then(load)}>
                  💰 {t('garage.sell', { price: fcfa(v.resaleValue) })}
                </button>
              </div>
            );
          })}
          <small className="muted">{t('garage.fuelPrice', { price: fcfa(garage.fuelPricePerL) })}</small>
        </>
      )}

      {tab === 'shop' && (
        <>
          <p className="muted">{t('garage.shopHint')}</p>
          {(['MOTO', 'CAR'] as const).map((kind) => (
            <div key={kind}>
              <h3>{kind === 'MOTO' ? `🏍️ ${t('garage.motos')}` : `🚗 ${t('garage.cars')}`}</h3>
              <ul className="list stacked">
                {garage.models.filter((m) => m.kind === kind).map((m: VehicleModel) => (
                  <li key={m.id} className="item">
                    <div className="item-main">
                      <strong>{m.emoji} {localName(m, i18n.language)}</strong>
                      <small>{en ? m.descEn : m.descFr}</small>
                      <small className="muted">{t('garage.specs', { tank: m.tankL, cons: ((m.mlPerKm * 100) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }), every: m.serviceEveryKm, service: fcfa(m.serviceCost), seats: m.seats })}</small>
                    </div>
                    <button className="btn primary" disabled={busy || garage.mine.length >= garage.maxVehicles || BigInt(state.wallet.balance) < BigInt(m.price)} onClick={() => void run(() => buyVehicle(m.id), () => t('garage.bought', { name: localName(m, i18n.language), price: fcfa(m.price) })).then(() => (load(), setTab('mine')))}>
                      {fcfa(m.price)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {garage.mine.length >= garage.maxVehicles && <p className="warning">{t('garage.full', { max: garage.maxVehicles })}</p>}
        </>
      )}
    </section>
  );
}
