import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TransportMode, Venue } from '../api/types';
import { fcfa, hhmm, isOpenAt, localName } from '../lib/format';
import { distanceMeters, estimateFare } from '../lib/transport';
import { useGame } from '../phone/ctx';
import type { BrandPlace } from '../api/endpoints';

const MODES: { id: TransportMode; icon: string }[] = [
  { id: 'WALK', icon: '🚶' },
  { id: 'BUS', icon: '🚌' },
  { id: 'WORO', icon: '🚕' },
  { id: 'ZEM', icon: '🛵' },
  { id: 'MOTO', icon: '🏍️' },
  { id: 'CAR', icon: '🚗' },
];

interface Props {
  /** Lieu choisi, ou null pour « chez moi ». */
  venue: Venue | null;
  /** Partenaire propriétaire du lieu (bâtiment de marque) : bandeau à ses couleurs, logo et lien vers son site. */
  brand?: BrandPlace | null;
  from: { x: number; z: number };
  to: { x: number; z: number };
  here: boolean;
  /** Métier à exercer ici : le lieu est ouvert pour s'y rendre, on masque les articles et on explique la suite. */
  workFor?: string | null;
  onGo: (mode: TransportMode) => void;
  onEnter: () => void;
  onClose: () => void;
}

/** Fiche d'un lieu (carte) : description, activités sur place, choix du transport et prix estimé. */
export default function VenueSheet({ venue, brand, from, to, here, workFor, onGo, onEnter, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { catalog, state, busy, clock, openApp } = useGame();
  const hoursText = (id: string) => {
    const h = catalog?.hours[id];
    if (!h || (h[0] === 0 && h[1] === 24)) return ` · ${t('hours.always')}`;
    return ` · ${isOpenAt(h, clock.parts().hour) ? t('hours.openUntil', { time: hhmm(h[1] % 24, 0) }) : t('hours.closedUntil', { time: hhmm(h[0], 0) })}`;
  };
  // Avec un véhicule personnel qui roule et qui a de l'essence, c'est lui qui est proposé d'abord (y compris pour rentrer chez soi)
  const [mode, setMode] = useState<TransportMode>(() => {
    const ok = (kind: 'MOTO' | 'CAR') => state[kind === 'MOTO' ? 'hasMoto' : 'hasCar'] && !!catalog?.transport[kind] && state.vehicles.some((v) => v.kind === kind && v.drivable && v.fuelMl > 0);
    return ok('MOTO') ? 'MOTO' : ok('CAR') ? 'CAR' : 'ZEM';
  });
  const en = i18n.language === 'en';
  const meters = distanceMeters(from.x, from.z, to.x, to.z);
  const fareOf = (m: TransportMode) => (catalog?.transport[m] ? estimateFare(meters, catalog.transport[m], state.economy?.transportBp) : 0);
  const price = fareOf(mode);
  // Véhicule personnel : carburant nécessaire (pas de tarif) ; il faut un véhicule en état avec assez d'essence
  const ownTrip = (kind: 'MOTO' | 'CAR') => {
    const vs = state.vehicles.filter((v) => v.kind === kind);
    const need = (mlPerKm: number) => Math.ceil((meters * mlPerKm) / 1000);
    const ok = vs.find((v) => v.drivable && v.fuelMl >= need(v.mlPerKm));
    const ref = ok ?? vs[0];
    return { ok: !!ok, anyDrivable: vs.some((v) => v.drivable), liters: ref ? need(ref.mlPerKm) / 1000 : 0, cost: ref ? Math.round((need(ref.mlPerKm) * state.fuelPricePerL) / 1000) : 0 };
  };
  const own = mode === 'MOTO' || mode === 'CAR' ? ownTrip(mode) : null;
  const balance = BigInt(state.wallet.balance);
  // Avant de partir : lieu fermé à l'arrivée, ou pas assez d'énergie pour y travailler (trajet compris) → on le dit tout de suite
  const venueHours = venue ? catalog?.hours[venue.id] : undefined;
  const closedNow = !here && !!venue && !!venueHours && !isOpenAt(venueHours, clock.parts().hour);
  const jobHere = !here && venue?.app === 'work' ? state.jobs.map((j) => catalog?.jobs.find((c) => c.id === j.id)).filter((j) => !!j) : [];
  const needEnergy = jobHere.length > 0 ? Math.min(...jobHere.map((j) => j!.energyCost)) : 0;
  const tripEnergy = catalog?.transport[mode] ? Math.ceil((meters * catalog.transport[mode].energyPerKm) / 1000) : 0;
  const tooTired = needEnergy > 0 && state.needs.energy - tripEnergy < needEnergy;
  const km = (meters / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 });

  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="venue-card" role="dialog" aria-modal="true" aria-label={venue ? localName(venue, i18n.language) : t('home.title')}>
        <div className="sheet-grip" aria-hidden="true" />
        {brand ? (
          <header className="brand-head" style={{ background: `linear-gradient(135deg, ${brand.color}, ${brand.color}bb)` }}>
            <span className="brand-logo" aria-hidden={!brand.logo}>{brand.logo ? <img src={brand.logo} alt={brand.name} /> : <b>{brand.label.slice(0, 1).toUpperCase()}</b>}</span>
            <div>
              <span className="brand-tier">{brand.tier === 'GOLD' ? '👑' : brand.tier === 'SILVER' ? '⭐' : '🥉'} {t(`vip.name.${brand.tier}`, { defaultValue: t(`partners.tier.${brand.tier}`) })}</span>
              <h2>{brand.label}</h2>
              <small>{brand.name} · {t(`billboard.kinds.${brand.kind}`)}{venue && hoursText(venue.id)}</small>
            </div>
            <button className="btn ghost small close" onClick={onClose} aria-label={t('app.close')}>✕</button>
          </header>
        ) : (
        <header className="venue-head">
          <span className="venue-emoji" aria-hidden="true">{venue?.emoji ?? '🏠'}</span>
          <div>
            <h2>{venue ? localName(venue, i18n.language) : t('home.title')}</h2>
            <small>
              {venue ? (en ? venue.districtEn : venue.districtFr) : t(`housing.${state.housing}`)}
              {venue && hoursText(venue.id)}
            </small>
          </div>
          <button className="btn ghost small close" onClick={onClose} aria-label={t('app.close')}>✕</button>
        </header>
        )}
        <p className="venue-desc">{venue ? (en ? venue.descEn : venue.descFr) : t('home.desc')}</p>
        {brand?.url && (
          <button type="button" className="btn ghost small brand-site" onClick={() => window.open(brand.url!, '_blank', 'noopener,noreferrer')}>🔗 {t('billboard.visit', { host: new URL(brand.url).host })}</button>
        )}
        {workFor && !here && (
          <div className="work-banner" role="note">
            <span aria-hidden="true">💼</span>
            <p><strong>{t('venue.workBannerTitle', { job: workFor })}</strong><br />{t('venue.workBannerText')}</p>
          </div>
        )}
        {venue && venue.activities.length > 0 && !workFor && (
          <ul className="chips" aria-label={t('venue.activities')}>
            {venue.activities.slice(0, 4).map((a) => (
              <li key={a.id} className="chip-act">
                <span aria-hidden="true">{a.emoji}</span> {localName(a, i18n.language)}
                <b>{a.price > 0 ? fcfa(a.price) : t('venue.free')}</b>
              </li>
            ))}
            {venue.activities.length > 4 && <li className="chip-act more">+ {t('venue.articles', { count: venue.activities.length - 4 })}</li>}
          </ul>
        )}
        {here ? (
          <button className="btn primary big go" onClick={onEnter}>{t('venue.youAreHere')}</button>
        ) : (
          <>
            <p className="muted small-line">{t('venue.distance', { km })}</p>
            <div className="modes" role="radiogroup" aria-label={t('venue.transport')}>
              {MODES.filter((m) => (m.id !== 'CAR' || (state.hasCar && catalog?.transport.CAR)) && (m.id !== 'MOTO' || (state.hasMoto && catalog?.transport.MOTO))).map((m) => {
                const f = fareOf(m.id);
                return (
                  <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'mode active' : 'mode'} onClick={() => setMode(m.id)}>
                    <span aria-hidden="true">{m.icon}</span>
                    <strong>{t(`transport.${m.id}`)}</strong>
                    <small>{m.id === 'MOTO' || m.id === 'CAR' ? (() => { const o = ownTrip(m.id); return o.ok ? `⛽ ${o.liters.toLocaleString(undefined, { maximumFractionDigits: 2 })} L` : o.anyDrivable ? t('venue.noFuel') : t('venue.needsRepair'); })() : f > 0 ? fcfa(f) : t('venue.free')}</small>
                  </button>
                );
              })}
            </div>
            <p className="muted small-line">{t(`transport.hint.${mode}`)}</p>
            {own && <p className={own.ok ? 'muted small-line' : 'error small-line'}>{own.ok ? t('venue.ownFuel', { l: own.liters.toLocaleString(undefined, { maximumFractionDigits: 2 }), price: fcfa(own.cost) }) : own.anyDrivable ? t('venue.noFuelHint') : t('venue.needsRepairHint')}</p>}
            {closedNow && venueHours && <p className="error small-line">{t('venue.closedNow', { time: hhmm(venueHours[0], 0) })}</p>}
            {!closedNow && tooTired && <p className="error small-line">{t('venue.tooTired', { need: needEnergy, have: state.needs.energy })}</p>}
            {state.location === 'home' && venue && (
              // Avant de quitter la maison : composer sa tenue (haut, bas ou robe, chaussures)
              <button className="btn ghost go-outfit" onClick={() => openApp('clothes')}>👕 {t('clothes.changeBefore')}</button>
            )}
            <button className="btn primary big go" disabled={busy || closedNow || tooTired || balance < BigInt(price) || (own !== null && !own.ok)} onClick={() => onGo(mode)}>
              {mode === 'MOTO' ? t('venue.goMoto') : mode === 'CAR' ? t('venue.goCar') : price > 0 ? t('venue.goPaid', { price: fcfa(price) }) : t('venue.go')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
