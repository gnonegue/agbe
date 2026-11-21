import { useCallback, useEffect, useMemo, useState } from 'react';
import { dayHasRain, seasonOfDay, totalOf, weatherNow } from '../game/weather';
import { consumeFocusSection } from '../lib/focus';
import { useTranslation } from 'react-i18next';
import { callSamu, payMedicalBill, consultDoctor, doAnalyses, getVisit, type MedicalVisit, getCourses, payAmu, getPartnerOffers, getTrade, treatIllness, type CourseInfo, type PartnerOffer, type TradeGood } from '../api/endpoints';
import { fcfa, hhmm, localName } from '../lib/format';
import { useGame } from './ctx';
import { nearestOf } from '../lib/nearest';
import { matches } from '../lib/search';

/** Petit hachage déterministe (même résultat pour tous les joueurs un jour donné). */
const hash = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

/** Lieux : tous les lieux de la ville où l'on se trouve, par quartier, avec recherche, « Y aller » et accès à la carte. */
export function PlacesApp() {
  const { t, i18n } = useTranslation();
  const { catalog, goTo, state, showMap } = useGame();
  const [q, setQ] = useState('');
  const en = i18n.language.startsWith('en');
  const venues = (catalog?.venues ?? []).filter((v) => v.city === (state.city ?? 'lome') && matches(q, v.nameFr, v.nameEn, v.districtFr, v.districtEn));
  return (
    <section>
      <button className="btn big" onClick={showMap}>🗺️ {t('apps2.map.open')}</button>
      <input className="catalog-search" type="search" placeholder={t('apps2.places.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="list stacked">
        {venues.map((v) => (
          <li key={v.id} className={v.id === state.location ? 'item current' : 'item'}>
            <div className="item-main">
              <strong>
                {v.emoji} {localName(v, i18n.language)}
              </strong>
              <small>{en ? v.districtEn : v.districtFr}</small>
              <small className="muted">{t('apps2.places.count', { count: v.activities.length })}</small>
            </div>
            {v.id === state.location ? <span className="badge ok">📍 {t('apps2.places.here')}</span> : <button className="btn small" onClick={() => goTo(v.id)}>🗺️ {t('apps2.places.go')}</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Agenda : ce qui compte aujourd'hui (travail, repos, cours, loyer). */
export function AgendaApp() {
  const { t, i18n } = useTranslation();
  const { state, openApp } = useGame();
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  useEffect(() => {
    void getCourses().then(setCourses, () => setCourses([]));
  }, []);
  const day = state.gameTime.day;
  const rentDays = state.rent.paidUntilGameDay - day;
  const enrolled = courses.filter((c) => c.enrolled && !c.completed);
  const rows: { icon: string; text: string; app?: Parameters<typeof openApp>[0] }[] = [];
  if (state.job) rows.push({ icon: '💼', text: state.nextWorkInGameHours > 0 ? t('apps2.agenda.workIn', { h: Math.ceil(state.nextWorkInGameHours) }) : t('apps2.agenda.workNow', { job: localName(state.job, i18n.language) }), app: 'work' });
  else rows.push({ icon: '💼', text: t('apps2.agenda.noJob'), app: 'work' });
  rows.push({ icon: '🛏️', text: state.nextRestInGameHours > 0 ? t('apps2.agenda.restIn', { h: Math.ceil(state.nextRestInGameHours) }) : t('apps2.agenda.restNow'), app: 'rest' });
  for (const c of enrolled) rows.push({ icon: c.emoji, text: t('apps2.agenda.class', { course: localName(c, i18n.language), time: hhmm(c.startHour, 0) }), app: 'study' });
  if (state.rent.monthly > 0) rows.push({ icon: state.rent.overdue ? '⚠️' : '🏠', text: state.rent.overdue ? t('apps2.agenda.rentLate') : t('apps2.agenda.rentIn', { count: Math.max(0, rentDays) }), app: 'rent' });
  if (state.company) rows.push({ icon: '🏢', text: t('apps2.agenda.company', { name: state.company.name }), app: 'company' });
  return (
    <section>
      <p className="muted">{t('apps2.agenda.today', { weekday: t(`weekdays.${state.gameTime.day % 7}`), day: state.gameTime.day + 1, time: hhmm(state.gameTime.hour, state.gameTime.minute) })}</p>
      <ul className="list stacked">
        {rows.map((r, i) => (
          <li key={i} className="item">
            <div className="item-main">
              <strong>
                {r.icon} {r.text}
              </strong>
            </div>
            {r.app && <button className="btn small" onClick={() => openApp(r.app!)}>{t('apps2.open')}</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const NEWS = 12;

/** Infos : actualité du jour (brèves locales, cours du port, événements des partenaires). */
export function NewsApp() {
  const { t, i18n } = useTranslation();
  const { state, openApp } = useGame();
  const [goods, setGoods] = useState<TradeGood[]>([]);
  const [events, setEvents] = useState<PartnerOffer[]>([]);
  useEffect(() => {
    void getTrade().then((r) => setGoods(r.goods), () => setGoods([]));
    void getPartnerOffers().then((o) => setEvents(o.filter((x) => x.kind === 'EVENT')), () => setEvents([]));
  }, [state.gameTime.day]);
  const day = state.gameTime.day;
  const briefs = useMemo(() => {
    const h = hash(`news${day}`);
    return [h % NEWS, (h >>> 4) % NEWS, (h >>> 8) % NEWS].filter((v, i, a) => a.indexOf(v) === i);
  }, [day]);
  // Meilleur écart du jour entre achat et revente
  const best = [...goods].sort((a, b) => b.sellToday - b.buyToday - (a.sellToday - a.buyToday))[0];
  return (
    <section>
      <p className="muted">{t('apps2.news.edition', { day: day + 1 })}</p>
      <ul className="list stacked">
        {(state.economy?.events ?? []).map((e) => (
          <li key={e} className="item">
            <div className="item-main">
              <strong>📢 {t(`economyEvents.${e}.title`, { defaultValue: e })}</strong>
              <small>{t(`economyEvents.${e}.text`, { defaultValue: '' })}</small>
            </div>
          </li>
        ))}
        {briefs.map((i) => (
          <li key={i} className="item">
            <div className="item-main">
              <strong>{t(`apps2.news.items.${i}.title`)}</strong>
              <small>{t(`apps2.news.items.${i}.text`)}</small>
            </div>
          </li>
        ))}
        {best && (
          <li className="item">
            <div className="item-main">
              <strong>🚢 {t('apps2.news.port', { item: localName(best, i18n.language) })}</strong>
              <small>{t('apps2.news.portText', { buy: fcfa(best.buyToday), sell: fcfa(best.sellToday) })}</small>
            </div>
            <button className="btn small" onClick={() => openApp('trade')}>{t('apps2.open')}</button>
          </li>
        )}
        {events.slice(0, 3).map((e) => (
          <li key={e.id} className="item">
            <div className="item-main">
              <strong>🎉 {e.title}</strong>
              <small>
                {e.partner} · {e.place}
                {e.happensAt ? ` · ${new Date(e.happensAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
              </small>
              <small className="muted">{e.body}</small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Santé : état du corps, conseils et soins du CHU. */
/** Dossier médical à l'hôpital : consultation → analyses demandées → résultats → interprétation et ordonnance → « Se traiter ». */
function MedicalFile({ ill, share, consultPrice }: { ill: { id: string | null; diagnosed: boolean } | null | undefined; share: (price: number) => number; consultPrice: number }) {
  const { t, i18n } = useTranslation();
  const { state, run, busy, playConsult, openApp } = useGame();
  const en = i18n.language === 'en';
  // Après la scène chez le médecin, on rouvre le dossier : l'étape suivante (analyses, ordonnance) y attend le joueur
  const backToFile = () => openApp('health');
  const [visit, setVisit] = useState<MedicalVisit | null>(null);
  const reload = useCallback(async () => {
    const r = await run(getVisit);
    setVisit(r?.visit ?? null);
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload, state.illness?.id, state.illness?.diagnosed]);
  const flagLabel = (f: string) => t(`health2.flag.${f}`);
  return (
    <div className="medfile">
      {!visit && (
        <button className="btn primary" disabled={busy} onClick={() => void run(consultDoctor, (r) => t('health2.consultDone', { paid: fcfa(r.result.paid) })).then((r) => { if (!r) return; setVisit(r.result.visit); playConsult(['examine'], backToFile); })}>
          🩺 {t('health2.consult', { price: fcfa(share(consultPrice)) })}
        </button>
      )}
      {visit && (
        <>
          <h4>1 · {t('health2.exam')}</h4>
          <ul className="vitals">
            <li><span>🌡️ {t('health2.temp')}</span><b>{visit.vitals.temp} °C</b></li>
            <li><span>💓 {t('health2.pulse')}</span><b>{visit.vitals.pulse} /min</b></li>
            <li><span>🩸 {t('health2.bp')}</span><b>{visit.vitals.bp}</b></li>
          </ul>
          <p className="muted">{en ? visit.examEn : visit.examFr}</p>

          <h4>2 · {t(visit.status === 'CONSULTED' ? 'health2.ordered' : 'health2.results')}</h4>
          <table className="lab">
            <thead>
              <tr><th>{t('health2.analysis')}</th><th>{visit.status === 'CONSULTED' ? t('health2.price') : t('health2.value')}</th><th>{t('health2.ref')}</th></tr>
            </thead>
            <tbody>
              {visit.analyses.map((a) => (
                <tr key={a.id}>
                  <td>🧪 {en ? a.nameEn : a.nameFr}</td>
                  {a.result ? (
                    <td className={`flag ${a.result.flag}`}><b>{en ? a.result.valueEn : a.result.valueFr}</b> {a.unit} <small>{flagLabel(a.result.flag)}</small></td>
                  ) : (
                    <td>{fcfa(a.price)}</td>
                  )}
                  <td className="muted">{en ? a.refEn : a.refFr} {a.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visit.status === 'CONSULTED' && (
            <button className="btn primary" disabled={busy} onClick={() => void run(doAnalyses, (r) => t('health2.analysesDone', { paid: fcfa(r.result.paid) })).then((r) => { if (!r) return; setVisit(r.result.visit); playConsult(['results', 'prescription'], backToFile); })}>
              🧪 {t('health2.doAnalyses', { price: fcfa(visit.pendingTotal) })}
            </button>
          )}

          {visit.interpretation && (
            <>
              <h4>3 · {t('health2.interpretation')}</h4>
              <p className="interpret">🩺 {en ? visit.interpretation.en : visit.interpretation.fr}</p>
            </>
          )}
          {visit.prescription && (
            <>
              <h4>4 · {t('health2.prescription')}</h4>
              <div className="rx">
                <div className="rx-cards">
                  {visit.prescription.items.map((i) => (
                    <div key={i.id} className="rx-card">
                      <span className="rx-ic" aria-hidden="true">💊</span>
                      <div className="rx-card-body">
                        <strong>{en ? i.nameEn : i.nameFr}</strong>
                        <small>{en ? i.doseEn : i.doseFr}</small>
                      </div>
                      <span className="rx-price">{fcfa(i.price)}</span>
                    </div>
                  ))}
                </div>
                <p className="rx-total">{t('health2.rxTotal', { total: fcfa(visit.prescription.total), pay: fcfa(visit.prescription.patientTotal) })}</p>
              </div>
              {ill?.diagnosed && (
                <button className="btn primary big" disabled={busy || BigInt(state.wallet.balance) < BigInt(visit.prescription.patientTotal)} onClick={() => void run(treatIllness, (r) => t('health2.treated', { paid: fcfa(r.result.paid) })).then(() => reload())}>
                  💊 {t('health2.treat', { price: fcfa(visit.prescription.patientTotal) })}
                </button>
              )}
            </>
          )}
          {visit.interpretation && !visit.prescription && <p className="ok">{t('health2.noTreatment')}</p>}
        </>
      )}
    </div>
  );
}

type HealthTab = 'health' | 'amu' | 'hospital';
const HEALTH_TAB_ICON: Record<HealthTab, string> = { health: '❤️', amu: '🩺', hospital: '🏥' };

export function HealthApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, goTo, run, busy } = useGame();
  // Ouverte depuis la pastille rouge « AMU » : directement sur l'onglet de l'assurance
  const [tab, setTab] = useState<HealthTab>(() => (consumeFocusSection() === 'amu' ? 'amu' : 'health'));
  const n = state.needs;
  const advice: string[] = [];
  if (n.health < 40) advice.push(t('apps2.health.sick'));
  if (n.energy < 25) advice.push(t('apps2.health.tired'));
  if (n.hunger < 25) advice.push(t('apps2.health.hungry'));
  if (n.hygiene < 25) advice.push(t('apps2.health.dirty'));
  if (advice.length === 0) advice.push(t('apps2.health.fine'));
  // Les hôpitaux AMU de la ville où se trouve le joueur (une ville peut en avoir plusieurs) ; Lomé à défaut.
  const nearestH = nearestOf(catalog ?? null, state, state.amu.hospitals);
  const hospitals = catalog?.venues.filter((v) => state.amu.hospitals.includes(v.id) && v.city === (state.city ?? 'lome')) ?? [];
  return (
    <section>
      <div className="chat-tabs" role="tablist">
        {(['health', 'amu', 'hospital'] as HealthTab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(x)}>
            {HEALTH_TAB_ICON[x]} {t(`health2.tabs.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'health' && (
        <>
      <div className="panel">
        <strong>❤️ {t('apps2.health.status', { value: n.health })}</strong>
        {advice.map((a) => (
          <small key={a}>• {a}</small>
        ))}
      </div>
      {(() => {
        // Maladie : symptômes d'abord ; le nom et le traitement après une consultation à l'hôpital
        const ill = state.illness;
        const atHospital = state.amu.hospitals.includes(state.location);
        const share = (price: number) => (state.amu.covered ? Math.round((price * (10_000 - state.amu.coverageBp)) / 10_000) : price);
        return (
          <div className={`panel ${ill ? 'danger' : ''}`}>
            <strong>🤒 {t('health2.title')}</strong>
            {!ill && <p className="ok">{t('health2.healthy')}</p>}
            {ill && !ill.diagnosed && <p className="warning">{t('health2.symptoms', { day: ill.sinceDay })}</p>}
            {ill?.diagnosed && ill.id && <p className="warning">{t('health2.diagnosed', { name: t(`health2.ill.${ill.id}`, { defaultValue: ill.id }) })}</p>}
            {atHospital ? (
              <MedicalFile ill={ill} share={share} consultPrice={catalog?.health?.consultPrice ?? 0} />
            ) : (
              ill && (
                <div className="chips">
                  {hospitals.map((h) => (
                    <button key={h.id} className="chip-act" onClick={() => goTo(h.id)}>📍 {localName(h, i18n.language)}</button>
                  ))}
                </div>
              )
            )}
            <small className="muted">{t('health2.prevent')}</small>
          </div>
        );
      })()}
        </>
      )}
      {tab === 'amu' && (
      <div className={`panel ${state.amu.covered ? '' : 'danger'}`}>
        <strong>🩺 {t('amu.title')}</strong>
        <p className={state.amu.covered ? 'ok' : 'error'}>
          {state.amu.covered ? t('amu.covered', { day: state.amu.paidUntilGameDay, pct: state.amu.coverageBp / 100 }) : t('amu.notCovered')}
        </p>
        <small className="muted">{t('amu.how')}</small>
        <button
          className="btn big"
          disabled={busy || BigInt(state.wallet.balance) < BigInt(state.amu.monthly)}
          onClick={() => void run(payAmu, (res) => t('amu.paid', { amount: fcfa(res.result.paid ?? state.amu.monthly) }))}
        >
          {t('amu.pay', { amount: fcfa(state.amu.monthly) })}
        </button>
      </div>
      )}
      {tab === 'hospital' && nearestH && (
        <div className="panel">
          <button className="btn primary big" onClick={() => goTo(nearestH.venue.id)}>
            🏥 {t('apps2.health.goNearest', { name: localName(nearestH.venue, i18n.language), km: nearestH.km.toLocaleString(i18n.language, { maximumFractionDigits: 1 }) })}
          </button>
          <small className="muted">{t('apps2.health.orChoose')}</small>
        </div>
      )}
      {tab === 'hospital' && hospitals.map((h) => (
        <div key={h.id} className="panel">
          <strong>
            {h.emoji} {localName(h, i18n.language)}
          </strong>
          <ul className="list stacked">
            {h.activities.map((a) => (
              <li key={a.id} className="item">
                <div className="item-main">
                  <strong>
                    {a.emoji} {localName(a, i18n.language)}
                  </strong>
                </div>
                <b>{a.price > 0 ? fcfa(a.price) : t('venue.free')}</b>
              </li>
            ))}
          </ul>
          {state.location !== h.id && <button className="btn primary big" onClick={() => goTo(h.id)}>📍 {t('apps2.health.go', { place: localName(h, i18n.language) })}</button>}
        </div>
      ))}
    </section>
  );
}

/** SAMU : appel d'urgence (santé très basse) et règlement de la facture de soins qui en découle. */
export function SamuApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy } = useGame();
  const hospital = catalog?.venues.find((v) => v.id === state.samu.hospitalId);
  const hospitalName = hospital ? localName(hospital, i18n.language) : state.samu.hospitalId;
  return (
    <section>
      <div className="panel">
        <strong>❤️ {t('apps2.health.status', { value: state.needs.health })}</strong>
        <small className="muted">{t('samu.appHint')}</small>
      </div>
      {state.medicalBill && (
        <div className="panel danger">
          <strong>🧾 {t('samu.billTitle')}</strong>
          <p>{t('samu.billText', { amount: fcfa(state.medicalBill.amount), full: fcfa(state.medicalBill.fullAmount) })}</p>
          <button className="btn primary big" disabled={busy || BigInt(state.wallet.balance) < BigInt(state.medicalBill.amount)} onClick={() => void run(payMedicalBill, (r) => t('samu.billPaid', { amount: fcfa(r.result.paid) }))}>
            💳 {t('samu.billPay', { amount: fcfa(state.medicalBill.amount) })}
          </button>
        </div>
      )}
      {state.samu.canCall ? (
        <div className="panel danger">
          <strong>🚑 {t('samu.title')}</strong>
          <p>{t('samu.text', { hospital: hospitalName, hours: state.samu.stayGameHours, fee: fcfa(state.samu.fee) })}</p>
          <button className="btn primary big" disabled={busy} onClick={() => void run(callSamu, () => t('samu.called'))}>
            📞 {t('samu.call')}
          </button>
          <small className="muted">{t('samu.amuHint')}</small>
        </div>
      ) : (
        !state.medicalBill && (
          <div className="panel">
            <p className="ok">{t('samu.fine')}</p>
            <small className="muted">{t('samu.statusBelow', { value: state.samu.callBelowHealth })}</small>
          </div>
        )
      )}
    </section>
  );
}

/** Prévision d'un jour de jeu à Lomé : pluie selon le même calendrier que la ville 3D (voir game/weather.ts). */
export function lomeForecast(day: number) {
  const season = seasonOfDay(day);
  const h = hash(`meteo${day}`);
  const rain = dayHasRain(day);
  const base = { harmattan: 31, rains: 29, dry: 27, smallRains: 29 }[season];
  const max = base + ((h >>> 8) % 3) - (rain ? 2 : 0);
  const sky = rain ? (h % 2 ? '🌧️' : '⛈️') : season === 'harmattan' ? '🌫️' : (h >>> 3) % 3 === 0 ? '⛅' : '☀️';
  return { season, rain, max, min: max - 6 - ((h >>> 12) % 2), sky };
}

/** Texte « la pluie s'arrête / commence vers hh:mm », ou null si rien de prévu à court terme. */
export function weatherChangeText(t: (k: string, o?: Record<string, unknown>) => string, total: number, change: { raining: boolean; inMin: number } | null): string | null {
  if (!change) return null;
  const at = (total + change.inMin) % 1440;
  const time = `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(Math.floor(at % 60)).padStart(2, '0')}`;
  return t(change.raining ? 'apps2.weather.stopsAt' : 'apps2.weather.startsAt', { time });
}

/**
 * Météo de Lomé : saison selon le mois de jeu (harmattan, grande saison des pluies, petite saison sèche, petite saison des pluies),
 * variation du jour déterministe.
 */
export function WeatherApp() {
  const { t } = useTranslation();
  const { state } = useGame();
  const total = totalOf(state.gameTime);
  const now = weatherNow(total);
  const today = lomeForecast(state.gameTime.day);
  const change = weatherChangeText(t, total, now.change);
  return (
    <section>
      <div className="panel weather-now">
        <span className="weather-sky" aria-hidden="true">{now.sky}</span>
        <strong>{t('apps2.weather.nowTemp', { temp: now.temp })}</strong>
        <small>{t(now.rain > 0 ? 'apps2.weather.raining' : now.night ? 'apps2.weather.clearNight' : 'apps2.weather.clearDay')}{change ? ` · ${change}` : ''}</small>
        <small>{t(`apps2.weather.seasons.${now.season}`)}</small>
        <small className="muted">{t('apps2.weather.now', { max: today.max, min: today.min })} · {today.rain ? t('apps2.weather.rain') : t('apps2.weather.dryDay')}</small>
      </div>
      <ul className="list stacked">
        {[1, 2, 3, 4].map((k) => {
          const f = lomeForecast(state.gameTime.day + k);
          return (
            <li key={k} className="item">
              <div className="item-main">
                <strong>
                  {f.sky} {t('apps2.weather.day', { day: state.gameTime.day + k + 1 })}
                </strong>
                <small>{t('apps2.weather.range', { max: f.max, min: f.min })}</small>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Calculatrice simple (entiers et décimaux), utile pour compter ses marges. */
export function CalcApp() {
  const { t } = useTranslation();
  const [a, setA] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [cur, setCur] = useState('0');
  const press = (k: string) => {
    if (/^[0-9]$/.test(k)) setCur((c) => (c === '0' ? k : c.length < 12 ? c + k : c));
    else if (k === ',') setCur((c) => (c.includes('.') ? c : `${c}.`));
    else if (k === 'C') {
      setA(null);
      setOp(null);
      setCur('0');
    } else if (k === '=') {
      if (a === null || !op) return;
      const b = Number(cur);
      const r = op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : b === 0 ? NaN : a / b;
      setCur(Number.isFinite(r) ? String(Math.round(r * 100) / 100) : t('apps2.calc.error'));
      setA(null);
      setOp(null);
    } else {
      setA(Number(cur));
      setOp(k);
      setCur('0');
    }
  };
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', 'C', '0', ',', '+'];
  return (
    <section className="calc">
      <output className="calc-screen">
        {a !== null && <small>{`${a} ${op ?? ''}`}</small>}
        {cur.replace('.', ',')}
      </output>
      <div className="calc-keys">
        {keys.map((k) => (
          <button key={k} className={/[0-9,]/.test(k) ? 'calc-key' : 'calc-key op'} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button className="calc-key eq" onClick={() => press('=')}>=</button>
      </div>
    </section>
  );
}
