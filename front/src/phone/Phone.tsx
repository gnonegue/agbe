import { useEffect, useRef, useState } from 'react';
import { subBack } from './subBack';
import { useTranslation } from 'react-i18next';
import { HOME_ACT_EVENT, SLEEP_EVENT } from '../game/Interior';
import { fcfa, hhmm } from '../lib/format';
import { speak } from '../lib/voice';
import { consumeFocusSection } from '../lib/focus';
import { useGame, type AppId } from './ctx';
import EatApp from './EatApp';
import ClothesApp from './ClothesApp';
import KitchenApp from './KitchenApp';
import StudyApp from './StudyApp';
import JournalApp from './JournalApp';
import CompanyApp from './CompanyApp';
import TradeApp from './TradeApp';
import LandApp from './LandApp';
import InvestApp from './InvestApp';
import BankApp from './BankApp';
import { FxApp, NotesApp } from './ToolApps';
import MusicApp from './MusicApp';
import { ContactsApp, GamesApp, GuideApp, MessagesApp, RideApp } from './LifeApps';
import { AgendaApp, CalcApp, HealthApp, NewsApp, PlacesApp, SamuApp, WeatherApp, lomeForecast, weatherChangeText } from './MoreApps';
import { totalOf, weatherNow } from '../game/weather';
import WorkApp from './WorkApp';
import RestApp from './RestApp';
import RentApp from './RentApp';
import WalletApp from './WalletApp';
import ShopApp from './ShopApp';
import PayrollApp from './PayrollApp';
import SettingsApp from './SettingsApp';
import BugsApp from './BugsApp';
import AdsApp from './AdsApp';
import DashApp from './DashApp';
import ChatApp from './ChatApp';
import GarageApp from './GarageApp';
import AppGlyph, { hasGlyph } from './AppGlyph';
import TontineApp from './TontineApp';
import MarketApp from './MarketApp';
import TendersApp from './TendersApp';
import FamilyApp from './FamilyApp';
import IntercityApp from './IntercityApp';
import HotelApp from './HotelApp';
import { useLive } from '../lib/live';
import { focusSection } from '../lib/focus';
import { matches } from '../lib/search';
import { logout as apiLogout } from '../api/endpoints';

export const APPS: { id: AppId; icon: string; color: string }[] = [
  { id: 'dash', icon: '📊', color: 'c-indigo' },
  { id: 'chat', icon: '🗨️', color: 'c-green' },
  { id: 'messages', icon: '💬', color: 'c-blue' },
  { id: 'work', icon: '💼', color: 'c-green' },
  { id: 'ride', icon: '🛵', color: 'c-orange' },
  { id: 'garage', icon: '🏍️', color: 'c-brown' },
  { id: 'intercity', icon: '🚌', color: 'c-indigo' },
  { id: 'hotel', icon: '🏨', color: 'c-teal' },
  { id: 'contacts', icon: '📞', color: 'c-green' },
  { id: 'music', icon: '🎵', color: 'c-pink' },
  { id: 'games', icon: '🎲', color: 'c-purple' },
  { id: 'guide', icon: '💡', color: 'c-orange' },
  { id: 'wallet', icon: '💳', color: 'c-blue' },
  { id: 'tontine', icon: '🤝', color: 'c-orange' },
  { id: 'market', icon: '🧺', color: 'c-pink' },
  { id: 'family', icon: '👨‍👩‍👧', color: 'c-purple' },
  { id: 'company', icon: '🏢', color: 'c-teal' },
  { id: 'tenders', icon: '🏛️', color: 'c-indigo' },
  { id: 'study', icon: '📜', color: 'c-purple' },
  { id: 'trade', icon: '🚢', color: 'c-blue' },
  { id: 'estate', icon: '🏗️', color: 'c-orange' },
  { id: 'invest', icon: '📈', color: 'c-green' },
  { id: 'fx', icon: '💱', color: 'c-teal' },
  { id: 'notes', icon: '📝', color: 'c-orange' },
  { id: 'eat', icon: '🍲', color: 'c-orange' },
  { id: 'kitchen', icon: '🍳', color: 'c-orange' },
  { id: 'clothes', icon: '👗', color: 'c-pink' },
  { id: 'journal', icon: '📖', color: 'c-purple' },
  { id: 'rent', icon: '🏠', color: 'c-brown' },
  { id: 'rest', icon: '🛏️', color: 'c-indigo' },
  { id: 'payroll', icon: '🧾', color: 'c-teal' },
  { id: 'shop', icon: '🛍️', color: 'c-pink' },
  { id: 'ads', icon: '📢', color: 'c-orange' },
  { id: 'places', icon: '📍', color: 'c-orange' },
  { id: 'agenda', icon: '📅', color: 'c-pink' },
  { id: 'news', icon: '📰', color: 'c-gray' },
  { id: 'health', icon: '❤️', color: 'c-pink' },
  { id: 'samu', icon: '🚑', color: 'c-red' },
  { id: 'weather', icon: '⛅', color: 'c-blue' },
  { id: 'bank', icon: '🏦', color: 'c-indigo' },
  { id: 'calc', icon: '🧮', color: 'c-brown' },
  { id: 'bugs', icon: '🐞', color: 'c-orange' },
  { id: 'settings', icon: '⚙️', color: 'c-gray' },
];

interface Props {
  app: AppId | null;
  setApp: (a: AppId | null) => void;
  onClose: () => void;
}

/** Téléphone du jeu : écran d'accueil (heure, applis) ; une appli s'ouvre dans l'écran. */
/** « il y a 5 min » dans la langue du jeu (Intl, aucun texte en dur). */
function agoLabel(at: number, lang: string): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000));
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  if (min < 1) return rtf.format(0, 'minute');
  if (min < 60) return rtf.format(-min, 'minute');
  if (min < 1440) return rtf.format(-Math.round(min / 60), 'hour');
  return rtf.format(-Math.round(min / 1440), 'day');
}

export default function Phone({ app, setApp, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { state, clock, notifications, clearNotifications, dismissNotification, run, busy, logout: goOut } = useGame();
  /** Page des notifications (depuis l'accueil du téléphone ou la cloche) ; fermer une appli ouverte depuis elle y ramène. */
  const [showNotifs, setShowNotifs] = useState(false);
  // Ouvert par la cloche : on amène le centre de notifications à l'écran
  const notifRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (consumeFocusSection() === 'notifications') setShowNotifs(true);
  }, []);
  /** Alertes durables du jeu (elles durent tant que la situation n'est pas réglée) : chacune ouvre l'application concernée. */
  const alerts: { key: string; icon: string; text: string; go: () => void; app: AppId }[] = [];
  if (state.samu.canCall) alerts.push({ key: 'samu', icon: '🚑', text: t('samu.notifCanCall'), go: () => setApp('samu'), app: 'samu' });
  if (state.medicalBill) alerts.push({ key: 'bill', icon: '🏥', text: t('phone.medicalBillDue', { amount: fcfa(state.medicalBill.amount), app: t('phone.apps.samu') }), go: () => setApp('samu'), app: 'samu' });
  if (state.rent.overdue) alerts.push({ key: 'rent', icon: '⚠️', text: t('hud.rentOverdue'), go: () => setApp('rent'), app: 'rent' });
  if (!state.rent.homeless && (state.bills.ELEC.overdue || state.bills.WATER.overdue)) alerts.push({ key: 'bills', icon: '⚡', text: t('hud.billsOverdue'), go: () => (focusSection('bills'), setApp('rent')), app: 'rent' });
  if (state.illness) alerts.push({ key: 'ill', icon: '🤒', text: state.illness.diagnosed && state.illness.id ? t('health2.notifDiagnosed', { name: t(`health2.ill.${state.illness.id}`, { defaultValue: state.illness.id }) }) : t('health2.notifSymptoms'), go: () => setApp('health'), app: 'health' });
  if ((state.familyPending ?? 0) > 0) alerts.push({ key: 'family', icon: '📞', text: t('family.notif'), go: () => setApp('family'), app: 'family' });
  if (state.outages?.power) alerts.push({ key: 'power', icon: '💡', text: t('outage.powerNotif'), go: () => (focusSection('outages'), setApp('rent')), app: 'rent' });
  if (state.outages?.water) alerts.push({ key: 'water', icon: '🚱', text: t('outage.waterNotif'), go: () => (focusSection('outages'), setApp('rent')), app: 'rent' });
  const notifTotal = notifications.length + alerts.length;
  const lv = useLive();
  const p = clock.parts();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Déconnexion rapide depuis le téléphone (à côté de « Fermer »), avec confirmation pour éviter un tap accidentel.
  const [confirmLogout, setConfirmLogout] = useState(false);
  const doQuickLogout = async () => {
    const ok = await run(async () => {
      await apiLogout();
      return true;
    });
    if (ok) goOut();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Réinitialise la recherche quand on ouvre une app ou revient à l'accueil
  useEffect(() => {
    if (app) setSearch('');
    else searchRef.current?.focus();
  }, [app]);

  // Bouton « retour » du téléphone ou du navigateur : quitte l'appli ouverte, puis ferme le téléphone
  const live = useRef({ app, setApp, onClose });
  live.current = { app, setApp, onClose };
  // Une action du téléphone qui se joue dans le décor (repas, musique, sieste, sommeil…) ferme le téléphone :
  // sinon l'animation se déroule derrière l'écran flou et il faudrait le fermer à la main avant de pouvoir agir.
  useEffect(() => {
    let timer = 0;
    const closeSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => live.current.onClose(), 350);
    };
    window.addEventListener(HOME_ACT_EVENT, closeSoon);
    window.addEventListener(SLEEP_EVENT, closeSoon);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(HOME_ACT_EVENT, closeSoon);
      window.removeEventListener(SLEEP_EVENT, closeSoon);
    };
  }, []);
  useEffect(() => {
    window.history.pushState({ agbePhone: true }, '');
    const onPop = () => {
      const { app: open, setApp: set, onClose: close } = live.current;
      if (open) {
        if (!subBack()) set(null);
        window.history.pushState({ agbePhone: true }, '');
      } else close();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="phone-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="phone-overlay-top">
        <button className="phone-close btn small" onClick={onClose}>✕ {t('app.close')}</button>
        {confirmLogout ? (
          <span className="phone-logout-confirm">
            <button className="btn small danger" disabled={busy} onClick={() => void doQuickLogout()}>{t('app.confirm')}</button>
            <button className="btn small ghost" onClick={() => setConfirmLogout(false)}>{t('app.cancel')}</button>
          </span>
        ) : (
          <button className="phone-logout btn small ghost" onClick={() => setConfirmLogout(true)} aria-label={t('settings.logout')} title={t('settings.logout')}>
            🔒 {t('settings.logout')}
          </button>
        )}
      </div>
      <div className={app || showNotifs ? 'phone in-app' : 'phone'} role="dialog" aria-modal="true" aria-label={app ? t(`phone.apps.${app}`) : t('phone.title')}>
        <div className="phone-status">
          <span>{hhmm(p.hour, p.minute)}</span>
          <span className="island" aria-hidden="true" />
          <span>••• 4G</span>
        </div>
        {app === null && showNotifs ? (
          <div className="phone-app" lang={i18n.language}>
            <button className="phone-back" onClick={() => setShowNotifs(false)}>‹ {t('phone.notifications')}</button>
            <div className="phone-app-body notif-page">
              <header className="np-hero">
                <span className="np-hero-ico" aria-hidden="true">🔔</span>
                <div className="np-hero-text">
                  <strong>{notifTotal === 0 ? t('phone.notifEmpty') : t('phone.notifSummary', { count: notifTotal })}</strong>
                  <small>{alerts.length > 0 ? t('phone.notifUrgent', { count: alerts.length }) : t('phone.notifCalm')}</small>
                </div>
                {notifications.length > 0 && <button type="button" className="np-clear" onClick={clearNotifications}>{t('phone.clearNotifications')}</button>}
              </header>
              {notifTotal === 0 && (
                <div className="np-empty"><span aria-hidden="true">✨</span><p>{t('phone.notifAllClear')}</p></div>
              )}
              {alerts.length > 0 && (
                <>
                  <h4 className="np-title">{t('phone.notifToFix')}</h4>
                  <ul className="np-list">
                    {alerts.map((a, i) => (
                      <li key={a.key} className="np-card urgent" style={{ ['--i' as string]: i }}>
                        <button type="button" className="np-main" onClick={a.go}>
                          <span className="np-ico" aria-hidden="true">{a.icon}</span>
                          <span className="np-text">{a.text}</span>
                        </button>
                        <div className="np-foot">
                          <small>{t('phone.notifNow')}</small>
                          <span className="np-actions"><button type="button" className="np-go" onClick={a.go}>{t(`phone.apps.${a.app}`)} ›</button></span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {notifications.length > 0 && (
                <>
                  <h4 className="np-title">{t('phone.notifRecent')} <span className="np-count">{notifications.length}</span></h4>
                  <ul className="np-list" ref={notifRef as React.RefObject<HTMLUListElement>}>
                    {notifications.map((n, i) => {
                      const lead = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u.exec(n.msg);
                      const icon = lead?.[1] ?? (n.kind === 'error' ? '⚠️' : n.kind === 'info' ? '💡' : '✅');
                      const text = lead ? n.msg.slice(lead[0].length) : n.msg;
                      return (
                        <li key={n.id} className={`np-card ${n.kind}`} style={{ ['--i' as string]: i + alerts.length }}>
                          {/* Un appui ouvre l'application concernée ; sans application liée, il lit le message à voix haute */}
                          <button type="button" className="np-main" onClick={() => (n.app ? setApp(n.app) : speak(n.msg, i18n.language))}>
                            <span className="np-ico" aria-hidden="true">{icon}</span>
                            <span className="np-text">{text}</span>
                          </button>
                          <div className="np-foot">
                            <small title={new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}>{agoLabel(n.at, i18n.language)}</small>
                            <span className="np-actions">
                              {n.app && <button type="button" className="np-go" onClick={() => setApp(n.app!)}>{t(`phone.apps.${n.app}`)} ›</button>}
                              <button type="button" className="np-x" onClick={() => dismissNotification(n.id)} aria-label={t('phone.dismissNotification')}>✕</button>
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        ) : app === null ? (
          <div className="phone-home">
            <div className="lock-clock">{hhmm(p.hour, p.minute)}</div>
            <div className="lock-date">{t('phone.date', { weekday: t(`weekdays.${p.day % 7}`), day: p.day, city: t(`cities.${state.city ?? 'lome'}`) })}</div>
            {(() => {
              const total = totalOf(state.gameTime);
              const w = weatherNow(total);
              const d = lomeForecast(state.gameTime.day);
              const change = weatherChangeText(t, total, w.change);
              return (
                <button className="weather-widget" onClick={() => setApp('weather')} aria-label={t('phone.apps.weather')}>
                  <span className="weather-widget-sky" aria-hidden="true">{w.sky}</span>
                  <span>
                    <strong>{t('apps2.weather.nowTemp', { temp: w.temp })} · {t(w.rain > 0 ? 'apps2.weather.raining' : w.night ? 'apps2.weather.clearNight' : 'apps2.weather.clearDay')}</strong>
                    <small>
                      Lomé · {change ?? (d.rain ? t('apps2.weather.rain') : t('apps2.weather.dryDay'))}
                    </small>
                  </span>
                </button>
              );
            })()}
            {notifTotal > 0 && (
              <button type="button" className="notif-summary" onClick={() => setShowNotifs(true)}>
                <span aria-hidden="true">🔔</span>
                <strong>{t('phone.notifSummary', { count: notifTotal })}</strong>
                <span aria-hidden="true">›</span>
              </button>
            )}
            <input
              ref={searchRef}
              className="phone-search"
              type="search"
              placeholder={t('phone.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('phone.search')}
            />
            <ul className="app-grid">
              {APPS.filter((a) => matches(search, t(`phone.apps.${a.id}`))).map((a) => (
                <li key={a.id}>
                  <button className="app-icon" onClick={() => { setApp(a.id); setSearch(''); }}>
                    <span className={`icon ${a.color}`} aria-hidden="true">{hasGlyph(a.id) ? <AppGlyph id={a.id} /> : a.icon}</span>
                    <span>{t(`phone.apps.${a.id}`)}</span>
                    {a.id === 'rent' && (state.rent.overdue || state.bills.ELEC.overdue || state.bills.WATER.overdue) && <span className="badge-dot" aria-hidden="true" />}
                    {a.id === 'chat' && lv.unread > 0 && <span className="badge-dot" aria-hidden="true" />}
                    {a.id === 'family' && (state.familyPending ?? 0) > 0 && <span className="badge-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
              {search.trim() && APPS.filter((a) => matches(search, t(`phone.apps.${a.id}`))).length === 0 && (
                <li className="app-search-empty">{t('phone.searchEmpty')}</li>
              )}
            </ul>
          </div>
        ) : (
          <div className="phone-app" lang={i18n.language}>
            <button className="phone-back" onClick={() => subBack() || setApp(null)}>‹ {t(`phone.apps.${app}`)}</button>
            <div className="phone-app-body">
              {app === 'journal' && <JournalApp />}
              {app === 'company' && <CompanyApp />}
              {/* Industrie : onglet de l'appli Entreprise (une usine ou une zone franche est une entreprise) */}
              {app === 'industry' && <CompanyApp initialTab="industry" />}
              {app === 'tenders' && <TendersApp />}
              {app === 'trade' && <TradeApp />}
              {app === 'estate' && <LandApp />}
              {app === 'invest' && <InvestApp />}
              {app === 'fx' && <FxApp />}
              {app === 'notes' && <NotesApp />}
              {app === 'messages' && <MessagesApp />}
              {app === 'contacts' && <ContactsApp />}
              {app === 'guide' && <GuideApp />}
              {app === 'music' && <MusicApp />}
              {app === 'ride' && <RideApp />}
              {app === 'games' && <GamesApp />}
              {app === 'places' && <PlacesApp />}
              {app === 'agenda' && <AgendaApp />}
              {app === 'news' && <NewsApp />}
              {app === 'health' && <HealthApp />}
              {app === 'samu' && <SamuApp />}
              {app === 'weather' && <WeatherApp />}
              {app === 'bank' && <BankApp />}
              {app === 'calc' && <CalcApp />}
              {app === 'eat' && <EatApp />}
              {app === 'kitchen' && <KitchenApp />}
              {app === 'clothes' && <ClothesApp />}
              {app === 'study' && <StudyApp />}
              {app === 'work' && <WorkApp />}
              {app === 'rest' && <RestApp />}
              {app === 'rent' && <RentApp />}
              {app === 'wallet' && <WalletApp />}
              {app === 'shop' && <ShopApp />}
              {app === 'payroll' && <PayrollApp />}
              {app === 'settings' && <SettingsApp />}
              {app === 'bugs' && <BugsApp />}
              {app === 'ads' && <AdsApp />}
              {app === 'dash' && <DashApp />}
              {app === 'chat' && <ChatApp />}
              {app === 'tontine' && <TontineApp />}
              {app === 'market' && <MarketApp />}
              {app === 'family' && <FamilyApp />}
              {app === 'intercity' && <IntercityApp />}
              {app === 'hotel' && <HotelApp />}
              {app === 'garage' && <GarageApp />}
            </div>
          </div>
        )}
        <button className="home-bar" onClick={() => (app ? setApp(null) : onClose())} aria-label={app ? t('phone.home') : t('app.close')} />
      </div>
    </div>
  );
}
