import { useTranslation } from 'react-i18next';
import { intercity } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';

/** Cars entre les villes : départ depuis la gare routière, tarif et durée fixés par le serveur. */
export default function IntercityApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy, goTo } = useGame();
  const cfg = catalog?.intercity;
  if (!catalog || !cfg) return <p className="muted">{t('app.loading')}</p>;
  const here = state.city ?? 'lome';
  const gare = cfg.cities.find((c) => c.id === here)?.gare;
  const atGare = !!gare && state.location === gare;
  const factor = state.economy?.transportBp ?? 10_000;
  const gareVenue = catalog.venues.find((v) => v.id === gare);
  // Voyages fermés : seul le retour vers Lomé reste proposé (le serveur refuse les autres départs)
  const closed = !cfg.enabled;
  const routes = cfg.routes
    .filter((r) => r.a === here || r.b === here)
    .filter((r) => !closed || r.a === 'lome' || r.b === 'lome')
    .map((r) => ({ to: r.a === here ? r.b : r.a, price: Math.floor((r.price * factor + 5_000) / 10_000), hours: r.hours }))
    .sort((a, b) => a.hours - b.hours);
  const balance = BigInt(state.wallet.balance);

  return (
    <section>
      <p className="muted">{t('intercity.intro', { city: t(`cities.${here}`) })}</p>
      {closed && here === 'lome' ? (
        <p className="notice">🚧 {t('intercity.closed')}</p>
      ) : (
        <>
          {state.trip && <p className="notice">{t('intercity.onTrip', { city: t(`cities.${state.trip.to}`), time: new Date(state.trip.until).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}</p>}
          {!atGare && gareVenue && (
            <div className="panel">
              <p className="warning">{t('intercity.goToGare', { gare: localName(gareVenue, i18n.language) })}</p>
              {here === 'lome' && <button className="btn" onClick={() => goTo(gareVenue.id)}>🗺️ {localName(gareVenue, i18n.language)}</button>}
            </div>
          )}
          <ul className="list">
            {routes.map((r) => (
              <li key={r.to} className="item">
                <div className="item-main">
                  <strong>🚌 {t(`cities.${r.to}`)}</strong>
                  <small>{t('intercity.route', { hours: r.hours, price: fcfa(r.price), energy: cfg.energyPerHour * r.hours })}</small>
                </div>
                <button
                  className="btn small primary"
                  disabled={busy || !atGare || !!state.trip || balance < BigInt(r.price)}
                  onClick={() => void run(() => intercity(r.to), (res) => t('intercity.departed', { city: t(`cities.${r.to}`), hours: res.result.hours, paid: fcfa(res.result.paid) }))}
                >
                  {t('intercity.go', { price: fcfa(r.price) })}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small-line">{t('intercity.note')}</p>
        </>
      )}
    </section>
  );
}
