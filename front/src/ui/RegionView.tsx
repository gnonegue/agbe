import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { doActivity, travel } from '../api/endpoints';
import { distanceMeters, estimateFare } from '../lib/transport';
import { fcfa, localName } from '../lib/format';
import { useGame } from '../phone/ctx';
import BusTrip from './BusTrip';

/**
 * Villes des régions (Kpalimé, Sokodé, Kara, Dapaong) : pas de carte 3D, les lieux s'affichent en liste.
 * On s'y déplace à pied ou en zém, on y fait les activités du lieu, et la gare permet de reprendre le car.
 */
export default function RegionView() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy, openApp } = useGame();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!catalog) return null;
  const city = state.city ?? 'lome';
  const venues = catalog.venues.filter((v) => (v.city ?? 'lome') === city);
  const here = venues.find((v) => v.id === state.location);
  const gare = catalog.intercity?.cities.find((c) => c.id === city)?.gare;
  const amuHere = state.amu.covered && state.amu.hospitals.includes(state.location);
  const costOf = (p: number) => (amuHere ? p - Math.floor((p * state.amu.coverageBp) / 10_000) : p);
  const balance = BigInt(state.wallet.balance);
  const trip = state.trip && new Date(state.trip.until).getTime() > now ? state.trip : null;

  if (trip) {
    const left = Math.max(0, Math.ceil((new Date(trip.until).getTime() - now) / 1000));
    const until = new Date(trip.until).getTime();
    const since = trip.since ? new Date(trip.since).getTime() : until - 60_000;
    const ratio = Math.min(1, Math.max(0, (now - since) / Math.max(1, until - since)));
    return (
      <div className="region-view bus-mode">
        <BusTrip from={trip.from ?? 'lome'} to={trip.to} ratio={ratio} left={left} />
      </div>
    );
  }

  return (
    <div className="region-view">
      <header className="region-head">
        <h2>{t(`cities.${city}`)}</h2>
        <small className="muted">{t('region.subtitle')}</small>
      </header>
      {here && (
        <section className="panel">
          <h3>
            {here.emoji} {localName(here, i18n.language)}
          </h3>
          <p className="muted">{i18n.language === 'en' ? here.descEn : here.descFr}</p>
          <ul className="list">
            {here.activities.map((a) => (
              <li key={a.id} className="item">
                <div className="item-main">
                  <strong>
                    {a.emoji} {localName(a, i18n.language)}
                  </strong>
                </div>
                <button className="btn small" disabled={busy || balance < BigInt(costOf(a.price))} onClick={() => void run(() => doActivity(a.id), () => t('region.done', { name: localName(a, i18n.language) }))}>
                  {a.price > 0 ? fcfa(costOf(a.price)) : t('venue.free')}
                </button>
              </li>
            ))}
          </ul>
          {here.id === gare && (
            <button className="btn primary big" onClick={() => openApp('intercity')}>
              🚌 {t('region.takeBus')}
            </button>
          )}
        </section>
      )}
      <section className="panel">
        <h3>{t('region.places')}</h3>
        <ul className="list">
          {venues
            .filter((v) => v.id !== state.location)
            .map((v) => {
              const m = here ? distanceMeters(here.x, here.z, v.x, v.z) : 0;
              const zem = catalog.transport.ZEM ? estimateFare(m, catalog.transport.ZEM, state.economy?.transportBp) : 0;
              const go = (mode: 'WALK' | 'ZEM') => void run(() => travel(v.id, mode), () => t('region.arrived', { name: localName(v, i18n.language) }));
              return (
                <li key={v.id} className="item">
                  <div className="item-main">
                    <strong>
                      {v.emoji} {localName(v, i18n.language)}
                    </strong>
                    <small>
                      {(m / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} km · {i18n.language === 'en' ? v.districtEn : v.districtFr}
                    </small>
                  </div>
                  {m <= 1500 && (
                    <button className="btn small ghost" disabled={busy} onClick={() => go('WALK')}>
                      🚶
                    </button>
                  )}
                  <button className="btn small" disabled={busy || balance < BigInt(zem)} onClick={() => go('ZEM')}>
                    🛵 {fcfa(zem)}
                  </button>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
