import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bookHall, bookRoom, getHotel, hotelCheckout, rest, roomService, sleep } from '../api/endpoints';
import type { HotelView } from '../api/types';
import { fcfa, localName } from '../lib/format';
import RoomPicture from '../ui/RoomPicture';
import { useGame } from './ctx';

/** Équipements montrés par catégorie de chambre (texte traduit, `hotel.amen`). */
const AMENITIES: Record<string, string[]> = {
  standard: ['wifi', 'ac', 'tv'],
  superieure: ['wifi', 'ac', 'tv', 'minibar', 'balcony'],
  suite: ['wifi', 'ac', 'tv', 'minibar', 'lounge', 'bath'],
  presidentielle: ['wifi', 'ac', 'tv', 'minibar', 'lounge', 'jacuzzi', 'butler'],
};

/** Hôtel du 2 Février : chambres par catégorie (nombre limité), séjour, service en chambre, salles à la journée. */
export default function HotelApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy, goTo } = useGame();
  const [h, setH] = useState<HotelView | null>(null);
  const [nights, setNights] = useState(1);
  const [hallDay, setHallDay] = useState(1);

  const load = useCallback(async () => {
    const r = await run(getHotel);
    if (r) setH(r);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!h || !catalog) return <p className="muted">{t('app.loading')}</p>;
  const here = state.location === h.venueId;
  const venue = catalog.venues.find((v) => v.id === h.venueId);
  const balance = BigInt(state.wallet.balance);
  const after = <T,>(p: Promise<T | null>) => void p.then(load);
  const stay = h.stay;
  const maxNights = stay ? Math.max(0, h.maxNights - stay.nightsLeft) : h.maxNights;

  return (
    <section className="hotel">
      <div className="hotel-hero">
        <div className="hh-top">
          <strong>🏨 {venue ? localName(venue, i18n.language) : t('hotel.title')}</strong>
          <span className="hh-stars" aria-label={t('hotel.fiveStars')}>★★★★★</span>
        </div>
        <small>{t('hotel.tagline')}</small>
        <div className="hh-tags">
          {(['sea', 'pool', 'floors', 'meetings'] as const).map((k) => <span key={k} className="hh-tag">{t(`hotel.hero.${k}`)}</span>)}
        </div>
        <span className={here ? 'hh-pill ok' : 'hh-pill'}>{here ? `✅ ${t('hotel.hereNow')}` : `📍 ${t('hotel.notHere')}`}</span>
      </div>
      {!here && venue && (
        <p className="notice">
          {t('hotel.remote')} <button className="btn small" onClick={() => goTo(venue.id)}>🗺️ {t('hotel.goThere')}</button>
        </p>
      )}

      {stay && (
        <div className="panel">
          <h3>🛎️ {t('hotel.yourStay', { room: t(`hotel.rooms.${stay.roomType}`) })}</h3>
          <p>{t('hotel.nightsLeft', { n: stay.nightsLeft, day: stay.toDay })}</p>
          {here ? (
            <div className="row-actions">
              <button className="btn primary" disabled={busy || !!state.sleep} onClick={() => void run(sleep, () => t('hotel.sleeping'))}>🌙 {t('hotel.sleep')}</button>
              <button className="btn" disabled={busy} onClick={() => void run(rest, () => t('hotel.rested'))}>🛋️ {t('hotel.rest')}</button>
            </div>
          ) : (
            <p className="muted">{t('hotel.comeBack')}</p>
          )}
          {here && (
            <>
              <h4>{t('hotel.roomService')}</h4>
              <ul className="list">
                {h.roomService.map((m) => (
                  <li key={m.id} className="item">
                    <div className="item-main">
                      <strong>{m.emoji} {localName(m, i18n.language)}</strong>
                      <small>+{m.hunger} {t('needs.hunger')} · +{m.energy} {t('needs.energy')} · +{m.morale} {t('needs.morale')}</small>
                    </div>
                    <button className="btn small" disabled={busy || balance < BigInt(m.price)} onClick={() => after(run(() => roomService(m.id), () => t('hotel.served', { name: localName(m, i18n.language) })))}>
                      {fcfa(m.price)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button className="btn ghost small" disabled={busy} onClick={() => after(run(hotelCheckout, () => t('hotel.checkedOut')))}>{t('hotel.checkout')}</button>
        </div>
      )}

      <h3>{stay ? t('hotel.extendTitle') : t('hotel.roomsTitle')}</h3>
      {maxNights > 0 && (
        <div className="hotel-nights" role="group" aria-label={t('hotel.nights', { n: nights })}>
          <div className="hn-head">
            <strong>🌙 {t('hotel.nights', { n: Math.min(nights, maxNights) })}</strong>
            <small className="muted">{t('hotel.stayDates', { from: h.day + 1, to: h.day + Math.min(nights, maxNights) })}</small>
          </div>
          <div className="chips">
            {[1, 2, 3, 5, 7, 14, 30].filter((v) => v <= maxNights).map((v) => (
              <button key={v} type="button" className={`chip-act ${Math.min(nights, maxNights) === v ? 'app' : ''}`} aria-pressed={Math.min(nights, maxNights) === v} onClick={() => setNights(v)}>{v}</button>
            ))}
          </div>
        </div>
      )}
      <div className="room-grid">
        {h.rooms.map((r) => {
          const n = Math.min(nights, Math.max(1, maxNights));
          const total = r.nightly * n;
          const blocked = !!stay && stay.roomType !== r.id;
          const lvl = ({ standard: 0, superieure: 1, suite: 2, presidentielle: 3 } as Record<string, number>)[r.id] ?? 0;
          const stars = Math.min(5, lvl + 3);
          const amen = (AMENITIES[r.id] ?? AMENITIES.standard)!;
          const fill = r.count > 0 ? Math.round((r.free / r.count) * 100) : 0;
          const reason = blocked ? t('hotel.otherType') : maxNights === 0 ? t('hotel.maxReached') : !stay && r.free === 0 ? t('hotel.fullTonight') : balance < BigInt(total) ? t('hotel.noFunds') : null;
          return (
            <article key={r.id} className={`room-card ${r.free === 0 ? 'full' : ''}`}>
              <div className="room-pic-wrap">
                <RoomPicture kind={r.id} />
                <span className="room-stars" aria-label={`${stars} ★`}>{'★'.repeat(stars)}</span>
                {lvl === 3 && <span className="room-crown">👑</span>}
              </div>
              <div className="room-body">
                <div className="room-title">
                  <strong>{t(`hotel.rooms.${r.id}`)}</strong>
                  <span className="room-price"><b>{fcfa(r.nightly)}</b><small>{t('hotel.perNightShort')}</small></span>
                </div>
                <small className="muted">{t(`hotel.roomDesc.${r.id}`)}</small>
                <div className="room-amen">
                  {amen.map((k) => <span key={k} className="amen">{t(`hotel.amen.${k}`)}</span>)}
                </div>
                <div className="room-avail" aria-label={r.free > 0 ? t('hotel.free', { n: r.free, total: r.count }) : t('hotel.fullTonight')}>
                  <div className="bar"><span style={{ width: `${fill}%` }} className={fill < 20 ? 'low' : ''} /></div>
                  <small className={r.free === 0 ? 'down' : fill < 20 ? 'warn' : 'muted'}>{r.free > 0 ? t('hotel.free', { n: r.free, total: r.count }) : t('hotel.fullTonight')}</small>
                </div>
                <button className="btn primary" disabled={busy || !!reason} onClick={() => after(run(() => bookRoom(r.id, n), (res) => t('hotel.booked', { room: t(`hotel.rooms.${r.id}`), day: res.result.untilDay })))}>
                  {stay ? t('hotel.extend', { n, price: fcfa(total) }) : t('hotel.book', { n, price: fcfa(total) })}
                </button>
                {reason && <small className="room-reason">{reason}</small>}
              </div>
            </article>
          );
        })}
      </div>

      <h3>🏛️ {t('hotel.hallsTitle')}</h3>
      <div className="hotel-nights">
        <div className="hn-head">
          <strong>📅 {t('hotel.hallDay', { n: hallDay, day: h.day + hallDay })}</strong>
        </div>
        <div className="chips">
          {[0, 1, 2, 3, 7, 14, 30].map((v) => (
            <button key={v} type="button" className={`chip-act ${hallDay === v ? 'app' : ''}`} aria-pressed={hallDay === v} onClick={() => setHallDay(v)}>{v === 0 ? t('hotel.today') : `+${v}`}</button>
          ))}
        </div>
      </div>
      <ul className="list">
        {h.halls.map((hall) => {
          const taken = hall.booked.find((b) => b.day === h.day + hallDay);
          return (
            <li key={hall.id} className="item">
              <div className="item-main">
                <strong>{t(`hotel.halls.${hall.id}`)}</strong>
                <small>{t('hotel.hallInfo', { n: hall.capacity, price: fcfa(hall.daily) })}</small>
                {taken && <small className={taken.mine ? 'ok' : 'down'}>{taken.mine ? t('hotel.hallMine') : t('hotel.hallTaken')}</small>}
              </div>
              <button className="btn small" disabled={busy || !!taken || balance < BigInt(hall.daily)} onClick={() => after(run(() => bookHall(hall.id, hallDay), (r) => t('hotel.hallBooked', { day: r.result.day })))}>
                {t('hotel.rent')}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small-line">{t('hotel.partyNote')}</p>
    </section>
  );
}
