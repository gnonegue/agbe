import { isPaused, isPlaying, musicVolume, onMusicChange, setMusicDuck, setMusicVolume, togglePause, stopMusic } from '../lib/music';
import { playTogoRadio } from '../lib/musicCatalog';
import { useReminders } from './useReminders';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DANCE_EVENT, HOME_ACT_EVENT, HOME_ACT_STATE, HOME_STOP_EVENT, SLEEP_EVENT, type HomeAct } from '../game/Interior';
import { WORSHIP_EVENT, type WorshipAct } from '../game/Worship';
import ZemBikeSheet from '../ui/ZemBikeSheet';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { getHomeFurniture, type HomeFurnitureView, getGarage, getKitchen, getLand, getLandZone, getPlots, type SeaGrid, type SeaPlot, getBrandPlaces, getFreeSpots, type FreeSpot, type BrandPlace, billboardClick, billboardView, doActivity, getHistory, getBillboards, getCatalog, type Billboard, getCharacter, getPurchase, payRent, rest, sleep, wake, listenMusic, watchTv, readBook, serveMission, startShift, stopShift, zemContract, travel, wash } from '../api/endpoints';
import type { Catalog, Me, State, TransportMode, Venue } from '../api/types';
import { errorText, setPlaceNames } from '../i18n';
import { GameClock } from '../game/clock';
import { detectQuality } from '../game/quality';
import type { CityHandle } from '../game/CityScene';
import { BRAND_INTERIOR, INTERIOR_OF, type InteriorBrand, type InteriorKind } from '../game/Interior';
import { CONSULT_EVENT, type ConsultDetail, type ConsultPhase } from '../game/Clinic';
import { defaultLook, isSavedLook, resolveLook, setGarments, wearOf, type PersonLook } from '../game/kit';
import { live, myPosition, useLive, type Announce, type DmMsg } from '../lib/live';
import DmPanel from '../ui/DmPanel';
import { announceApp, announceText } from '../lib/announce';
import RegionView from '../ui/RegionView';
import { focusSection } from '../lib/focus';
import LookEditor from '../ui/LookEditor';
import MapBar from '../ui/MapBar';
import BookPlot from '../ui/BookPlot';
import { drawAdArt, type CityVenue } from '../game/World';
import { fcfa, hhmm, localName, shortDuration , isOpenAt} from '../lib/format';
import { NO_VOICE_EVENT, speak } from '../lib/voice';
import { setStreetIndoors, updateStreetSound } from '../lib/streetSound';
import { getSavedQuality, loadJournal, saveJournal, saveQuality, type JournalEntry, type Quality } from '../lib/prefs';
import { Ctx, type AppId, type GameCtx } from '../phone/ctx';
import ChatApp from '../phone/ChatApp';
import { TopBar, Stats } from '../ui/Hud';
import Phone from '../phone/Phone';
import VenueSheet from '../ui/VenueSheet';
import Joystick from '../ui/Joystick';
import HomeDecor, { furnitureItems } from '../ui/HomeDecor';
import { takeTradeArrival } from '../lib/tradeFocus';
import Tour from '../ui/Tour';
import VipSpaceSheet from '../ui/VipSpaceSheet';
import { DESK, INDOOR_JOBS, stationOf } from '../game/workstation';
import type { LandZoneView } from '../game/landLayer';
import { setLandFocus } from '../lib/landFocus';
import type { InteriorHandle } from '../game/InteriorScene';
import ClassRoom from '../ui/ClassRoom';
import ConferenceRoom from '../ui/ConferenceRoom';
import BookBoard from '../ui/BookBoard';
import type { ConferenceInfo, ConferenceTalk, CourseInfo } from '../api/endpoints';
import { useCountdown } from '../phone/WorkApp';
import { Splash } from '../ui/Splash';
import { matches } from '../lib/search';
import { holdAutoReload } from '../lib/pwaUpdate';

/** Démarches proposées sur la fiche d'un lieu, selon l'appli qui lui est associée (venue.app) : appli et onglet ouverts directement. */
const VENUE_SHORTCUTS: Record<string, { app: AppId; tab?: string; ico: string; label: string }[]> = {
  study: [
    { app: 'study', tab: 'higher', ico: '🎓', label: 'venue.study.higher' },
    { app: 'study', tab: 'pro', ico: '🛠️', label: 'venue.study.pro' },
    { app: 'study', tab: 'courses', ico: '📚', label: 'venue.study.courses' },
    { app: 'study', tab: 'conferences', ico: '🎤', label: 'venue.study.conferences' },
  ],
  bank: [
    { app: 'bank', tab: 'agency', ico: '🏦', label: 'venue.bank.agency' },
    { app: 'bank', tab: 'mobile', ico: '📱', label: 'venue.bank.mobile' },
    { app: 'bank', tab: 'loan', ico: '💵', label: 'venue.bank.loan' },
  ],
  telecom: [
    { app: 'wallet', ico: '📲', label: 'venue.telecom.money' },
    { app: 'bank', tab: 'mobile', ico: '💰', label: 'venue.telecom.savings' },
  ],
};

// Three.js est chargé à part (chunk dédié) : l'écran de connexion reste léger.
const CityScene = lazy(() => import('../game/CityScene'));
const InteriorScene = lazy(() => import('../game/InteriorScene'));
const BusRideScene = lazy(() => import('../game/BusRideScene'));

const REFRESH_MS = 20_000;
const HOME = 'home';

/** À la fin d'une séance de travail, on revient au lieu où l'on a pris son service. */
function ShiftEnd({ active, onEnd }: { active: boolean; onEnd: () => void }) {
  const was = useRef(active);
  useEffect(() => {
    if (was.current && !active) onEnd();
    was.current = active;
  }, [active, onEnd]);
  return null;
}

/** Où l'on est : la maison, un intérieur, la rue ; la carte est une vue d'ensemble. */
type View = 'home' | 'inside' | 'street' | 'map';

/** Application du téléphone où régler un problème signalé par un code d'erreur de l'API. */
const ERROR_APP: Record<string, AppId> = {
  insufficient_funds: 'wallet',
  unpaid_bill: 'health',
  water_cut: 'rent',
  power_cut: 'rent',
  rent_overdue: 'rent',
  evicted: 'rent',
  fee_unpaid: 'study',
  not_at_shop: 'kitchen',
  missing_ingredient: 'kitchen',
  no_fuel: 'kitchen',
  no_appliance: 'kitchen',
  no_freezer: 'eat',
  freezer_full: 'eat',
  job_locked: 'study',
  too_tired: 'eat',
  amu_required: 'health',
  no_company: 'company',
  company_not_registered: 'company',
  unknown_tender: 'tenders',
  tender_closed: 'tenders',
  already_applied: 'tenders',
  wrong_sector: 'tenders',
  over_delay: 'tenders',
  loan_already_open: 'bank',
  over_cap: 'bank',
  no_open_loan: 'bank',
  over_remaining: 'bank',
};
/** Activités de culte jouées dans l'église et la mosquée : prier seul, assister à l'office, faire une offrande. */
const WORSHIP_OF: Record<string, WorshipAct> = { cath_priere: 'pray', cath_messe: 'mass', cath_offrande: 'offering', mosq_priere: 'pray', mosq_vendredi: 'mass', mosq_aumone: 'offering' };
const playWorship = (activityId: string): void => {
  const act = WORSHIP_OF[activityId];
  if (act) window.dispatchEvent(new CustomEvent<WorshipAct>(WORSHIP_EVENT, { detail: act }));
};
/** Activités qui se dansent : le joueur monte sur la piste du maquis. */
const DANCE_ACTS = new Set(['be_agbadja', 'deckon_sortie']);
const playDance = (activityId: string): void => {
  if (DANCE_ACTS.has(activityId)) window.dispatchEvent(new Event(DANCE_EVENT));
};
const viewFor = (location: string): View => (location === HOME ? 'home' : INTERIOR_OF[location] ? 'inside' : 'street');

/** Apparence par défaut tirée de l'identifiant (avant le premier passage dans l'éditeur). */

interface Props {
  me: Me;
  initialState: State;
  pendingPurchase: string | null;
  onPurchaseHandled: () => void;
  onLoggedOut: (msg?: string) => void;
}

interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'error' | 'info';
  app?: AppId;
}

/** Relecture des annonces : toutes les 5 min, ou juste après la fin de la prochaine qui expire. */
const ADS_REFRESH_MS = 5 * 60_000;
const untilNextEnd = (ends: (string | undefined)[]): number => {
  const now = Date.now();
  const next = Math.min(...ends.map((e) => (e ? Date.parse(e) : Infinity)).filter((t) => t > now));
  return Math.max(5_000, Math.min(ADS_REFRESH_MS, Number.isFinite(next) ? next - now + 2_000 : ADS_REFRESH_MS));
};
/** Empreinte d'une liste d'annonces : seul un vrai changement redessine la ville. */
const adsKey = (list: Billboard[]) => list.map((b) => `${b.id}:${b.endsAt}:${b.title}:${b.subtitle}:${b.hasImage ? 1 : 0}`).sort().join('|');
const plotsKey = (d: { plots: SeaPlot[]; zones?: { id: string; plots: SeaPlot[] }[] }) =>
  [...d.plots.map((p) => `sea:${p.id}:${p.live}:${p.endsAt}:${p.title}`), ...(d.zones ?? []).flatMap((z) => z.plots.map((p) => `${z.id}:${p.id}:${p.live}:${p.endsAt}:${p.title}`))].sort().join('|');

export default function GameScreen({ me, initialState, pendingPurchase, onPurchaseHandled, onLoggedOut }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>(initialState);
  // Nouvelle version en ligne : pas de rechargement surprise ici, seulement le bandeau « Mettre à jour »
  useEffect(() => holdAutoReload(), []);
  // Multijoueur : flux temps réel ouvert tant que l'écran de jeu est affiché
  useEffect(() => {
    live.start();
    return () => live.stop();
  }, []);
  // Annonces des autres joueurs (offre d'emploi, tontine, cérémonie, conférence) : elles arrivent dans la cloche des notifications
  // (et à voix haute), plus en bandeau sur l'écran ; un appui dans le centre de notifications ouvre l'appli concernée
  const announceHandler = useRef<(a: Announce) => void>(() => undefined);
  useEffect(() => live.onAnnounce((a) => announceHandler.current(a)), []);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [quality, setQualityState] = useState<Quality>(() => getSavedQuality() ?? detectQuality());
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const hudLeft = useRef<HTMLDivElement>(null);
  const [toastTop, setToastTop] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = hudLeft.current;
    if (!el) return;
    const place = () => setToastTop(el.offsetTop + el.offsetHeight + 8);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // Le joystick reste au-dessus du panneau du lieu, quelle que soit sa hauteur (adresse sur 2 lignes, actions…)
  const placePanel = useRef<HTMLDivElement>(null);
  const [joyMin, setJoyMin] = useState(0);
  useEffect(() => {
    const el = placePanel.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return setJoyMin(0);
    const place = () => setJoyMin(parent.clientHeight - el.offsetTop + 10);
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [app, setApp] = useState<AppId | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  // Scènes chargées à la demande : préchargées dès l'entrée en jeu, sinon l'écran de chargement masquait la ville au premier trajet
  useEffect(() => {
    void import('../game/BusRideScene');
    void import('../game/InteriorScene');
  }, []);
  const [view, setView] = useState<View>(() => viewFor(initialState.location));
  const [picked, setPicked] = useState<string | null>(null);
  // Maquis : la radio togolaise joue en fond, à volume bas, tant qu'on y est (sans couper la musique que le joueur écoute déjà)
  const inMaquis = view === 'inside' && INTERIOR_OF[state.location] === 'maquis' && !state.hospital;
  useEffect(() => {
    if (!inMaquis) return;
    let active = true;
    let started = false;
    setMusicDuck(0.22);
    if (!isPlaying()) {
      started = true;
      void playTogoRadio().then(() => {
        if (!active) stopMusic();
      });
    }
    return () => {
      active = false;
      setMusicDuck(1);
      if (started) stopMusic();
    };
  }, [inMaquis]);
  // Rappel du loyer dans le jeu : une fois par jour de jeu, affiché et lu à voix haute
  const [rentAlert, setRentAlert] = useState<string | null>(null);
  const rentAlertDay = useRef(-1);
  const [near, setNear] = useState<string | null>(null);
  /** Lieu dont on est devant l'entrée (entrée automatique). */
  const [arrive, setArrive] = useState<string | null>(null);
  const [travelling, setTravelling] = useState(false);
  /** Trajet en bus en cours : on le vit depuis l'intérieur, au milieu des autres passagers. */
  const [onBus, setOnBus] = useState(false);
  const [rideVehicle, setRideVehicle] = useState<'bus' | 'taxi'>('bus');
  /** En bus : suivre le véhicule depuis le dessus (carte) au lieu de l'intérieur. */
  const [busAbove, setBusAbove] = useState(false);
  // Avancement du trajet (barre en bas), lu dans la scène 4 fois par seconde
  const [trip, setTrip] = useState<{ ratio: number; secondsLeft: number; mode: string; to: string } | null>(null);
  useEffect(() => {
    if (!travelling) return setTrip(null);
    const id = window.setInterval(() => setTrip(city.current?.tripProgress() ?? null), 250);
    return () => window.clearInterval(id);
  }, [travelling]);
  /** Point de départ de la ville à son montage (l'ancien lieu pendant un trajet). */
  const [cityStart, setCityStart] = useState(initialState.location);
  // SAMU : avant la salle de soins, l'ambulance vient chercher le joueur là où il était (maison, rue, lieu). On retient donc
  // le dernier lieu hors hôpital ; au chargement en plein séjour, il n'y en a pas et l'on va directement en salle de soins.
  const lastLoc = useRef<string | null>(initialState.hospital ? null : initialState.location);
  const [amb, setAmb] = useState<null | 'coming' | 'loading'>(null);
  const [ambTrip, setAmbTrip] = useState<{ ratio: number; secondsLeft: number } | null>(null);
  const ambPlayed = useRef<string | null>(null);
  useEffect(() => {
    if (amb !== 'coming') return setAmbTrip(null);
    const id = window.setInterval(() => setAmbTrip(city.current?.ambulanceProgress() ?? null), 250);
    return () => window.clearInterval(id);
  }, [amb]);
  const [journal, setJournal] = useState<JournalEntry[]>(() => loadJournal(initialState.id));
  const clock = useMemo(() => new GameClock(), []);
  const toastId = useRef(0);
  const { i18n: i18nInst } = useTranslation();
  const i18nLang = useRef(i18nInst.language);
  i18nLang.current = i18nInst.language;

  useEffect(() => {
    const r = state.rent;
    const debt = BigInt(r.debt);
    if (!r.overdue && !r.homeless && debt <= 0n) return;
    if (rentAlertDay.current === state.gameTime.day) return;
    rentAlertDay.current = state.gameTime.day;
    const amount = fcfa(r.nextPayment);
    const msg = r.homeless
      ? t('rentAlert.homeless')
      : r.overdue
        ? (r.evictInDays ?? 0) > 0
          ? t('rentAlert.overdue', { months: r.overdueMonths, amount, days: r.evictInDays })
          : t('rentAlert.evictNow', { months: r.overdueMonths, amount })
        : t('rentAlert.debt', { amount: fcfa(r.debt) });
    // Fenêtre et voix seulement si c'est grave (sans logement, expulsion proche) ; sinon la pastille du haut suffit
    if (!r.homeless && !(r.overdue && (r.evictInDays ?? 99) <= 7)) return;
    setRentAlert(msg);
    speak(`${t('rentAlert.title')} ${msg}`, i18nLang.current);
  }, [state.rent, state.gameTime.day, t]);
  // Factures d'électricité ou d'eau impayées : prévenu une fois par jour de jeu, avec un bouton pour payer
  const billAlertDay = useRef<number | null>(null);
  const [billAlert, setBillAlert] = useState<string | null>(null);
  useEffect(() => {
    const late = (['ELEC', 'WATER'] as const).filter((b) => state.bills[b].overdue);
    if (late.length === 0 || state.rent.homeless) return;
    if (billAlertDay.current === state.gameTime.day) return;
    billAlertDay.current = state.gameTime.day;
    const total = late.reduce((s, b) => s + BigInt(state.bills[b].due ?? state.bills[b].monthly), 0n);
    const msg = t('billAlert.text', { bills: late.map((b) => t(`bills.${b}`)).join(', '), amount: fcfa(total.toString()), fee: state.rent.lateFeeBpPerDay / 100 });
    void msg; // les factures restent signalées par la pastille du haut, sans fenêtre ni voix
  }, [state.bills, state.rent.homeless, state.rent.lateFeeBpPerDay, state.gameTime.day, t]);
  const started = useRef(false);

  /** Ajoute une ligne datée (heure du jeu) au récit « Ma vie ». */
  const remember = useCallback(
    (text: string) => {
      const p = clock.parts();
      setJournal((l) => {
        const next = [{ id: Date.now() + Math.random(), day: p.day, time: hhmm(p.hour, p.minute), text }, ...l];
        saveJournal(initialState.id, next);
        return next;
      });
    },
    [clock, initialState.id],
  );

  const apply = useCallback(
    (s: State) => {
      clock.sync(s.gameTime, s.secondsPerGameDay);
      setState(s);
    },
    [clock],
  );

  const [notifications, setNotifications] = useState<GameCtx['notifications']>([]);
  /** Moment de la dernière ouverture du centre de notifications : au-delà, une notification est « nouvelle » (la cloche s'agite). */
  const [notifSeenAt, setNotifSeenAt] = useState(() => Date.now());
  const notifNew = notifications.some((n) => n.at > notifSeenAt);
  // Toutes les notifications vont dans la cloche (centre de notifications du téléphone) et sont lues à voix haute ; rien ne
  // s'affiche sur l'écran, sauf `onScreen` : le refus immédiat d'une action du joueur (pas assez d'argent, trop loin…).
  // Notifications effacées par le joueur : retenues pour la journée de jeu (dans ce navigateur), pour qu'un même rappel ne
  // revienne pas aussitôt dans la cloche (après « Tout effacer », un rechargement ou le tic suivant des rappels)
  const offKey = `agbe.notif.off.${me.id}`;
  const gameDay = () => Math.floor(clock.totalMinutes() / 1440);
  const readOff = (): string[] => {
    try {
      const v = JSON.parse(localStorage.getItem(offKey) ?? 'null') as { day: number; msgs: string[] } | null;
      return v && v.day === gameDay() ? v.msgs : [];
    } catch {
      return [];
    }
  };
  const silence = (msgs: string[]) => {
    try {
      localStorage.setItem(offKey, JSON.stringify({ day: gameDay(), msgs: [...new Set([...readOff(), ...msgs])].slice(-100) }));
    } catch {
      /* stockage indisponible : rien de retenu */
    }
  };
  const toast = useCallback((msg: string, kind: 'ok' | 'error' | 'info' = 'ok', app?: AppId, onScreen = false) => {
    // Déjà effacé aujourd'hui : on ne le remet pas dans la cloche et on ne le relit pas (sauf un refus immédiat, affiché à l'écran)
    if (!onScreen && readOff().includes(msg)) return;
    const id = ++toastId.current;
    // Un même message qui se répète (coupure d'eau, rappel…) remplace l'ancien au lieu de s'empiler
    setNotifications((l) => [{ id, msg, kind, at: Date.now(), app }, ...l.filter((x) => x.msg !== msg)].slice(0, 30));
    if (onScreen) {
      setToasts([{ id, msg, kind, app }]);
      // Durée proportionnelle à la longueur (temps de lecture) : au moins 3 s, 7 s au plus ; un clic la ferme tout de suite
      const ms = Math.min(7_000, Math.max(3_000, 1_200 + msg.length * 45));
      window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), ms);
    }
    // Lecture à voix haute (réglage du haut-parleur de la barre du haut) : à la suite, sans couper la précédente
    speak(msg, i18nLang.current, { queue: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  announceHandler.current = (a) => toast(announceText(a, t, i18nLang.current, (id) => localName(venueById.get(id) ?? { nameFr: id, nameEn: id }, i18nLang.current)), 'info', announceApp(a));

  /** Capture de la vue 3D, enregistrée en PNG sur l'appareil. */
  const takeScreenshot = useCallback(async () => {
    const blob = await city.current?.capture();
    if (!blob) return toast(t('capture.failed'), 'error');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `agbe-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(t('capture.done'));
  }, [t, toast]);

  // Rappels du rythme de la journée (heure du jeu) : repas matin, midi et soir, travail, coucher ; affichés et dits à voix haute
  const said = useRef<Record<string, number>>({});
  useEffect(() => {
    const SLOTS: { at: number; key: string; when: () => boolean }[] = [
      { at: 7 * 60, key: 'morning', when: () => true },
      { at: 12 * 60, key: 'lunch', when: () => state.needs.hunger < 85 },
      { at: 14 * 60 + 30, key: 'backToWork', when: () => !!state.job },
      { at: 18 * 60, key: 'endOfDay', when: () => !!state.job },
      { at: 19 * 60 + 30, key: 'dinner', when: () => state.needs.hunger < 85 },
      { at: 22 * 60, key: 'bedtime', when: () => !state.sleep },
    ];
    const tick = () => {
      if (state.sleep) return;
      const m = clock.minuteOfDay();
      const day = Math.floor(clock.totalMinutes() / 1440);
      for (const s of SLOTS) {
        // Fenêtre de 45 minutes de jeu après l'heure prévue, une fois par jour de jeu
        if (m >= s.at && m < s.at + 45 && said.current[s.key] !== day && s.when()) {
          said.current[s.key] = day;
          const msg = t(`daily.${s.key}${s.key === 'morning' && state.job ? 'Work' : ''}`);
          toast(msg);
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, [clock, state.needs.hunger, state.job, state.sleep, t, toast, i18nInst.language]);

  // Nombre d'alertes en attente dans le téléphone (pastille sur le bouton, même téléphone fermé)
  const lvAlerts = useLive();
  /** Chat ouvert sur le côté de l'écran (on continue de voir la ville). */
  const [sideChat, setSideChat] = useState(false);
  const phoneAlerts =
    (state.rent.overdue ? 1 : 0) +
    (!state.rent.homeless && (state.bills.ELEC.overdue || state.bills.WATER.overdue) ? 1 : 0) +
    (state.illness ? 1 : 0) +
    ((state.familyPending ?? 0) > 0 ? 1 : 0) +
    (state.outages?.power ? 1 : 0) +
    (state.outages?.water ? 1 : 0) +
    (lvAlerts.unread > 0 ? 1 : 0) +
    Object.values(lvAlerts.dmUnread).filter((n) => n > 0).length;

  // Rappels intelligents : santé, cours à suivre, messages, bonnes affaires (notification + lecture audio)
  useReminders({ state, clock, toast, t, lang: i18nInst.language, memoryKey: `agbe.remind.${me.id}`, venueName: (id) => localName(venueById.get(id) ?? { nameFr: id, nameEn: id }, i18nInst.language) });

  const playAct = (a: HomeAct) => {
    if (a !== 'music' && homeAct === 'music') stopMusic();
    window.dispatchEvent(new CustomEvent<HomeAct>(HOME_ACT_EVENT, { detail: a }));
  };
  /** Service demandé hors du lieu de travail : relancé tout seul à l'arrivée sur place (le joueur n'a pas à tout refaire). */
  /** Lieu de travail vers lequel on se rend pour commencer un service (explique la fiche du lieu). */
  const [workGoing, setWorkGoing] = useState<string | null>(null);
  const pendingWork = useRef<{ place: string; at: number; retry: () => void } | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: (r: T) => string | null): Promise<T | null> => {
      setBusy(true);
      try {
        const r = await fn();
        let replay = false;
        if (r && typeof r === 'object' && 'state' in r) {
          const a = r as unknown as { state: State; result?: { replay?: unknown } };
          apply(a.state);
          replay = a.result?.replay === true;
        }
        // Rejeu d'une requête déjà traitée : aucun nouvel effet, donc pas de message « payé X ».
        const msg = replay ? null : success?.(r);
        if (msg) {
          toast(msg, 'ok');
          remember(msg);
        }
        return r;
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'unknown';
        // « work_at_<lieu> » : le service se prend sur place, on propose d'y aller
        if (code.startsWith('work_at_') || code.startsWith('go_to_')) {
          const place = code.slice(code.startsWith('work_at_') ? 8 : 6);
          toast(t(code.startsWith('go_to_') ? 'errors.go_to' : 'errors.work_at'), 'error', undefined, true);
          // On quitte le téléphone et le choix de moto pour ouvrir tout de suite le choix du transport vers le lieu de travail
          setPhoneOpen(false);
          setZemSheet(false);
          setPicked(place);
          if (code.startsWith('work_at_')) setWorkGoing(place);
          if (code.startsWith('work_at_')) pendingWork.current = { place, at: Date.now(), retry: () => void run(fn, success) };
        } else if (code !== 'session_expired') toast(errorText(code), 'error', ERROR_APP[code], true);
        return null;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, toast, remember],
  );

  const setQuality = useCallback((q: Quality) => {
    saveQuality(q);
    setQualityState(q);
  }, []);

  // Synchronisation initiale + catalogue
  useEffect(() => {
    clock.sync(initialState.gameTime, initialState.secondsPerGameDay);
    // Première ouverture : le récit commence par la situation de départ
    if (!started.current && loadJournal(initialState.id).length === 0) {
      remember(t('journal.start', { housing: t(`housing.${initialState.housing}`), amount: fcfa(initialState.wallet.balance) }));
    }
    started.current = true;
    void getCatalog().then((c) => {
      // Vêtements du catalogue d'abord : la tenue de chacun se dessine avec
      setGarments(c.clothes);
      setCatalog(c);
    }, () => toast(errorText('network_error'), 'error', undefined, true));
  }, [clock, initialState, toast, remember, t]);

  // Rafraîchissement périodique de l'état (≈ 20 s), suspendu quand l'onglet est caché
  useEffect(() => {
    let timer = 0;
    const tick = async () => {
      if (!document.hidden) {
        try {
          apply(await getCharacter());
        } catch {
          /* erreurs réseau silencieuses ; 401 géré par le client */
        }
      }
      timer = window.setTimeout(() => void tick(), REFRESH_MS);
    };
    timer = window.setTimeout(() => void tick(), REFRESH_MS);
    return () => window.clearTimeout(timer);
  }, [apply]);

  // Retour de paiement : statut interrogé toutes les 3 s pendant 1 min max
  useEffect(() => {
    if (!pendingPurchase) return;
    let stopped = false;
    let timer = 0;
    const started = Date.now();
    toast(t('shop.checking'));
    const poll = async () => {
      if (stopped) return;
      try {
        const p = await getPurchase(pendingPurchase);
        if (p.status !== 'PENDING') {
          toast(t(`shop.status.${p.status}`), p.status === 'PAID' ? 'ok' : 'error');
          if (p.status === 'PAID') apply(await getCharacter());
          onPurchaseHandled();
          return;
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
          onPurchaseHandled();
          return;
        }
      }
      if (Date.now() - started > 60_000) {
        toast(t('shop.status.TIMEOUT'), 'error');
        onPurchaseHandled();
        return;
      }
      timer = window.setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [pendingPurchase, apply, toast, t, onPurchaseHandled]);

  const openApp = useCallback((id: AppId | null) => {
    setApp(id);
    setPhoneOpen(true);
  }, []);

  // Consultation illustrée : on voit le médecin examiner, commenter les résultats puis remettre l'ordonnance (dans la clinique, pas sur le téléphone)
  const playConsultRef = useRef<(phases: ConsultPhase[], onDone?: () => void) => void>(() => undefined);
  const playConsult = useCallback((phases: ConsultPhase[], onDone?: () => void) => playConsultRef.current(phases, onDone), []);
  // Lieux où l'on achète les appareils de cuisine (fourneaux, réfrigérateur) : le bouton « Appareils de cuisine » s'y affiche
  const [gearVenues, setGearVenues] = useState<string[]>([]);
  useEffect(() => {
    void getKitchen().then((k) => setGearVenues([...new Set(k.appliances.flatMap((a) => a.venues))]), () => undefined);
  }, []);
  // Stations-service : à l'arrivée, le joueur est sur sa moto (ou dans sa voiture) et un pompiste fait le plein
  const [stationIds, setStationIds] = useState<string[]>([]);
  useEffect(() => {
    if (!state.hasMoto && !state.hasCar) return;
    void getGarage().then((g) => setStationIds(g.stations), () => undefined);
  }, [state.hasMoto, state.hasCar]);
  // Plein payé dans le Garage : le pompiste de la station se met à servir
  useEffect(() => {
    const onFuel = () => city.current?.stationFuel();
    window.addEventListener('agbe:refuel', onFuel);
    return () => window.removeEventListener('agbe:refuel', onFuel);
  }, []);
  const goTo = useCallback((id: string) => {
    setPhoneOpen(false);
    setView('map');
    setPicked(id);
  }, []);
  const [lesson, setLesson] = useState<CourseInfo | null>(null);
  const [talk, setTalk] = useState<{ info: ConferenceInfo; talk: ConferenceTalk } | null>(null);
  const openConference = useCallback((info: ConferenceInfo, tk: ConferenceTalk) => {
    setPhoneOpen(false);
    setTalk({ info, talk: tk });
  }, []);
  const openClass = useCallback((c: CourseInfo) => {
    setPhoneOpen(false);
    setLesson(c);
  }, []);
  // La ville n'est construite qu'une fois les données de départ arrivées (panneaux, mer, terrains à vendre, marques) :
  // chaque arrivée tardive la reconstruisait entièrement (plusieurs secondes de blocage au lancement).
  const [initLoads, setInitLoads] = useState<Set<string>>(() => new Set());
  const settled = useCallback((k: string) => setInitLoads((s) => (s.has(k) ? s : new Set(s).add(k))), []);
  const [initTimeout, setInitTimeout] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setInitTimeout(true), 4000);
    return () => window.clearTimeout(id);
  }, []);
  const cityReady = initTimeout || initLoads.size >= 4;
  // Terrains à vendre dessinés sur la carte (zones, quarts vendus, constructions) ; relus régulièrement et après chaque action foncière
  const [landZones, setLandZones] = useState<LandZoneView[]>([]);
  const reloadLand = useCallback(() => {
    void getLand()
      .then((cat) => Promise.all(cat.zones.map((z) => getLandZone(z.id).then((plan) => ({ z, plan })))))
      .then((all) =>
        setLandZones(
          all.map(({ z, plan }) => ({
            id: z.id,
            label: i18nInst.language === 'en' ? z.nameEn : z.nameFr,
            sub: t('land.sign'),
            layout: plan.layout,
            planRows: plan.planRows,
            margin: plan.margin,
            sign: plan.sign,
            water: plan.water,
            owners: plan.owners,
          })),
        ),
      )
      .catch(() => undefined)
      .finally(() => settled('land'));
  }, [i18nInst.language, t, settled]);
  useEffect(() => {
    reloadLand();
    const id = window.setInterval(reloadLand, 60_000);
    return () => window.clearInterval(id);
  }, [reloadLand]);
  useEffect(() => {
    if (phoneOpen) setNotifSeenAt(Date.now());
  }, [phoneOpen, notifications]);
  const ctx: GameCtx = { playConsult, notifications, clearNotifications: () => setNotifications((l) => (silence(l.map((n) => n.msg)), [])), dismissNotification: (id: number) => setNotifications((l) => (silence(l.filter((n) => n.id === id).map((n) => n.msg)), l.filter((n) => n.id !== id))), me, state, catalog, clock, quality, setQuality, apply, run, busy, toast, logout: onLoggedOut, openApp, closePhone: () => setPhoneOpen(false), journal, goTo, openClass, openConference, openLook: () => setLookOpen(true), showMap: () => { setPhoneOpen(false); setView('map'); }, reloadLand, showLand: (zoneId: string) => { const z = landZones.find((x) => x.id === zoneId); setPhoneOpen(false); setView('map'); if (z) window.setTimeout(() => city.current?.focusAt(z.layout.originX + (z.layout.cols * z.layout.cell) / 2, z.layout.originZ + (z.layout.rows * z.layout.cell) / 2 + 20), 200); } };
  const city = useRef<CityHandle>(null);
  useEffect(() => {
    if (!state.hospital) lastLoc.current = state.location;
  }, [state.location, state.hospital]);
  // Arrivée au lieu choisi depuis le Commerce : l'appli s'ouvre d'elle-même sur l'article (quantité, acheter / vendre)
  useEffect(() => {
    if (takeTradeArrival(state.location)) openApp('trade');
  }, [state.location, openApp]);
  const hospitalStart = state.hospital?.startedAt ?? null;
  const hospitalVenue = state.hospital?.venueId ?? null;
  // L'ambulance doit encore passer chercher le joueur (mêmes conditions que l'effet ci-dessous) : tant que c'est le cas,
  // la salle de soins reste cachée, sinon elle apparaît une image avant le début de l'animation
  const ambDue = !!hospitalStart && !!hospitalVenue && ambPlayed.current !== hospitalStart && !!lastLoc.current && lastLoc.current !== hospitalVenue && Date.now() - Date.parse(hospitalStart) <= 60_000;
  useEffect(() => {
    if (!hospitalStart || !hospitalVenue || ambPlayed.current === hospitalStart) return;
    ambPlayed.current = hospitalStart;
    const pickup = lastLoc.current;
    // Appel depuis l'hôpital même, ou séjour déjà commencé depuis longtemps : directement en salle de soins
    if (!pickup || pickup === hospitalVenue || Date.now() - Date.parse(hospitalStart) > 60_000) return;
    void (async () => {
      setPhoneOpen(false);
      setAmb('coming');
      // Vue d'en haut : on voit l'ambulance traverser la ville jusqu'au joueur
      setCityStart(pickup);
      setView('map');
      for (let i = 0; i < 300 && (i < 2 || !city.current); i++) await new Promise((ok) => requestAnimationFrame(ok));
      const came = await city.current?.ambulanceCome(hospitalVenue, pickup);
      if (came) {
        // Dans la rue, au plus près : les secouristes installent le joueur sur le brancard
        setView('street');
        setAmb('loading');
        await new Promise((ok) => window.setTimeout(ok, 400));
        await city.current?.ambulanceLoad();
      }
      city.current?.ambulanceClear();
      // Le serveur le situe déjà à l'hôpital : il en ressortira par la porte des urgences
      setCityStart(hospitalVenue);
      city.current?.placeAt(hospitalVenue);
      setAmb(null);
    })();
  }, [hospitalStart, hospitalVenue]);
  const { i18n } = useTranslation();
  // Chaque réponse de l'API apporte un nouvel objet « look » : on compare le contenu, sinon la ville
  // serait reconstruite à chaque action (interface qui se « réinitialise », trajet qui saute à l'arrivée).
  const lookKey = JSON.stringify(state.look ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => (isSavedLook(state.look) ? state.look : { ...defaultLook(state.id), wear: wearOf(state.look) }), [lookKey, state.id]);
  // La tenue composée se dessine avec le catalogue des vêtements (chargé avec le catalogue du jeu)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo(() => resolveLook(state.look, state.id), [lookKey, state.id, catalog?.clothes]);
  // L'éditeur s'ouvre de lui-même tant que le joueur n'a pas choisi son apparence
  // Préférences de la carte (par appareil) : noms des lieux et panneaux
  const pref = (k: string) => {
    try {
      return localStorage.getItem(k) !== '0';
    } catch {
      return true;
    }
  };
  // Noms des lieux : masqués par défaut (vue moins chargée), visibles au survol ou via le bouton de la carte
  const [names, setNames] = useState(() => {
    try {
      return localStorage.getItem('agbe.mapNames2') === '1';
    } catch {
      return false;
    }
  });
  const [boardsOn, setBoardsOn] = useState(() => pref('agbe.mapBoards'));
  useEffect(() => {
    try {
      localStorage.setItem('agbe.mapNames2', names ? '1' : '0');
      localStorage.setItem('agbe.mapBoards', boardsOn ? '1' : '0');
    } catch {
      /* stockage indisponible */
    }
  }, [names, boardsOn]);
  const [lookOpen, setLookOpen] = useState(() => state.look === null);
  // Carte 3D : lieux de Lomé seulement (les villes des régions s'affichent en liste)
  const allVenues = catalog?.venues;
  const venues = useMemo(() => (allVenues ?? []).filter((v) => (v.city ?? 'lome') === 'lome'), [allVenues]);
  // Tous les lieux (y compris les villes des régions) : noms affichés, messages de trajet
  const venueById = useMemo(() => new Map((allVenues ?? []).map((v) => [v.id, v])), [allVenues]);
  // Messages d'erreur « il faut être à tel endroit » : avec le vrai nom du lieu
  useEffect(() => {
    setPlaceNames((id) => {
      const v = venueById.get(id);
      return v ? localName(v, i18nLang.current) : undefined;
    });
    return () => setPlaceNames(() => undefined);
  }, [venueById]);
  const homePos = state.homePos ?? catalog?.homePosition[state.housing] ?? { x: 0, z: 0 };
  const posOf = useCallback((id: string) => (id === HOME ? homePos : venueById.get(id) ?? homePos), [homePos, venueById]);
  const cityVenues = useMemo<CityVenue[]>(() => venues.map((v) => ({ id: v.id, emoji: v.emoji, label: localName(v, i18n.language), x: v.x, z: v.z })), [venues, i18n.language]);
  const homeKind = state.rent.homeless ? null : state.housing;
  const homeStyle = state.homeStyle ?? null;
  const cityHome = useMemo<CityVenue>(() => ({ id: HOME, emoji: '🏠', label: t('home.pin'), x: homePos.x, z: homePos.z, housing: homeKind, style: homeStyle }), [homePos.x, homePos.z, homeKind, homeStyle, t]);

  // Campagnes des partenaires (validées dans le tableau de bord) affichées sur les panneaux de la ville
  const [boards, setBoards] = useState<Billboard[]>([]);
  const [board, setBoard] = useState<Billboard | null>(null);
  /** Numéro du panneau touché quand l'annonce affichée est rotative (pour proposer une annonce fixe sur celui-ci). */
  const [boardPanel, setBoardPanel] = useState<number | null>(null);
  // Panneau sans annonce touché : son emplacement, proposé à la réservation
  const [freeSlot, setFreeSlot] = useState<number | null>(null);
  // Annonces relues toutes les 5 min et à la fin de la première qui expire : une pub échue disparaît à l'heure.
  // La liste n'est remplacée que si elle change (la ville est redessinée quand ses annonces changent).
  useEffect(() => {
    let timer = 0;
    let off = false;
    const load = () =>
      void getBillboards()
        .then((list) => {
          if (off) return;
          setBoards((prev) => (adsKey(prev) === adsKey(list) ? prev : list));
          window.clearTimeout(timer);
          timer = window.setTimeout(load, untilNextEnd(list.map((b) => b.endsAt)));
        }, () => undefined)
        .finally(() => settled('boards'));
    load();
    return () => {
      off = true;
      window.clearTimeout(timer);
    };
  }, [settled]);
  const ads = useMemo(() => boards.map((b) => ({ id: b.id, slot: b.slot, title: b.title, sub: b.subtitle, bg: b.bg, fg: b.fg, image: b.hasImage ? `/api/boards/${b.id}/image` : undefined })), [boards]);
  const openBoard = useCallback(
    (id: string, panel?: number) => {
      const b = boards.find((x) => x.id === id);
      if (!b) return;
      setBoard(b);
      setBoardPanel(panel ?? null);
      void billboardView(id).catch(() => undefined);
    },
    [boards],
  );
  // Parcelles en mer : grille, parcelles louées, case touchée (location) et parcelle touchée (fiche)
  const [seaData, setSeaData] = useState<{ grid: SeaGrid; pricePerPlot: number | null; periodDays?: number; periods?: number[]; plots: SeaPlot[]; zones?: { id: string; grid: SeaGrid; price?: number | null; plots: SeaPlot[] }[] } | null>(null);
  const [seaCell, setSeaCell] = useState<{ x: number; y: number; zone: string } | null>(null);
  const [plot, setPlot] = useState<SeaPlot | null>(null);
  // Mer et zones de pub : même rythme que les panneaux, une parcelle échue disparaît à la fin de sa location
  useEffect(() => {
    let timer = 0;
    let off = false;
    const load = () =>
      void getPlots()
        .then((d) => {
          if (off) return;
          const all = [...d.plots, ...(d.zones ?? []).flatMap((z) => z.plots)];
          setSeaData((prev) => (prev && plotsKey(prev) === plotsKey(d) ? prev : d));
          window.clearTimeout(timer);
          timer = window.setTimeout(load, untilNextEnd(all.map((p) => p.endsAt)));
        }, () => undefined)
        .finally(() => settled('sea'));
    load();
    return () => {
      off = true;
      window.clearTimeout(timer);
    };
  }, [settled]);
  const toSpec = (ps: SeaPlot[]) => ps.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, live: p.live, title: p.title, sub: p.subtitle, bg: p.bg, fg: p.fg, image: p.hasImage ? `/api/boards/${p.id}/image` : undefined }));
  const sea = useMemo(() => (seaData ? { grid: seaData.grid, plots: toSpec(seaData.plots) } : null), [seaData]);
  const adZones = useMemo(() => (seaData?.zones ?? []).map((z) => ({ id: z.id, grid: z.grid, plots: toSpec(z.plots) })), [seaData]);
  /** Grille et parcelles d'un espace de pub (la mer ou une zone). */
  const zoneData = useCallback(
    (zone: string) => (!seaData ? null : zone === 'sea' ? { grid: seaData.grid, price: seaData.pricePerPlot, plots: seaData.plots } : (seaData.zones ?? []).find((z) => z.id === zone) ?? null),
    [seaData],
  );
  const onSeaCell = useCallback(
    (x: number, y: number, zone: string) => {
      const z = zoneData(zone);
      if (!z) return;
      const taken = z.plots.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
      if (taken) toast(t('errors.plot_taken'), 'error');
      else setSeaCell({ x, y, zone });
    },
    [zoneData, toast, t],
  );
  const onPlot = useCallback(
    (id: string) => {
      const p = [...(seaData?.plots ?? []), ...(seaData?.zones ?? []).flatMap((z) => z.plots)].find((x) => x.id === id) ?? null;
      setPlot(p);
      if (p) void billboardView(id).catch(() => undefined);
    },
    [seaData],
  );
  // Lieux de marque des partenaires Argent et Or
  const [places, setPlaces] = useState<BrandPlace[]>([]);
  const [place, setPlace] = useState<BrandPlace | null>(null);
  useEffect(() => {
    void getBrandPlaces().then(setPlaces, () => undefined).finally(() => settled('brands'));
  }, [settled]);
  const brands = useMemo(() => places.map((p) => ({ id: p.id, label: p.label, color: p.color, model: p.model, logo: p.logo, x: p.x, z: p.z })), [places]);
  // Espaces VIP libres : balise « VIP SPACE » sur la carte, la fiche s'ouvre au toucher
  const [freeSpots, setFreeSpots] = useState<FreeSpot[]>([]);
  const [vip, setVip] = useState<FreeSpot | null>(null);
  useEffect(() => {
    void getFreeSpots().then(setFreeSpots, () => undefined);
  }, [places]);
  const vipSpots = useMemo(
    () => freeSpots.map((f) => ({ id: f.id, label: f.tier ? t(`vip.name.${f.tier}`) : t('vip.pin'), tier: f.tier, x: f.x, z: f.z })),
    [freeSpots, t],
  );
  const openVip = useCallback((id: string) => setVip(freeSpots.find((f) => f.id === id) ?? null), [freeSpots]);
  // Lieux des partenaires : on peut y entrer (intérieur selon le modèle du bâtiment)
  // Banques, agences Yas et Moov, BOAD et BCEAO : on y entre aussi (hall d'accueil, guichets et bureaux)
  useEffect(() => {
    for (const v of catalog?.venues ?? []) {
      if (v.id.startsWith('bank_') || ['yas', 'moov_africa', 'boad', 'bceao'].includes(v.id)) INTERIOR_OF[v.id] = 'office';
    }
  }, [catalog]);
  useEffect(() => {
    for (const v of catalog?.venues ?? []) {
      if (!v.id.startsWith('brand_')) continue;
      const p = places.find((x) => x.x === v.x && x.z === v.z);
      const kind = p && BRAND_INTERIOR[p.model];
      if (kind) INTERIOR_OF[v.id] = kind;
    }
  }, [catalog, places]);
  // Toucher un bâtiment de marque ouvre le lieu de jeu du partenaire (s'y rendre, soins, repas, travail…) ; sans lieu, sa simple fiche
  const openBrand = useCallback(
    (id: string) => {
      const p = places.find((x) => x.id === id) ?? null;
      const venue = p && catalog?.venues.find((v) => v.x === p.x && v.z === p.z && v.id.startsWith('brand_'));
      if (venue) setPicked(venue.id);
      else setPlace(p);
    },
    [places, catalog],
  );
  const busLines = useMemo(
    () => (
      [
        ['golfe', '#0a7d4f'],
        ['mono', '#22a861'],
        ['kara', '#d21034'],
        ['savanes', '#f18f01'],
      ] as const
    ).map(([k, color]) => ({ name: t(`buslines.${k}`), color })),
    [t],
  );

  const here: Venue | null = venueById.get(state.location) ?? null;
  const placeName = state.location === HOME ? t('home.title') : here ? localName(here, i18n.language) : '';
  const wait = useCountdown(state.nextWorkInGameHours, state.secondsPerGameDay || 3600);

  // Jeton partagé par toute activité qui déplace le personnage dans la ville (trajet libre, course, livraison) :
  // en démarrer une nouvelle invalide la précédente, qui s'arrête au lieu d'interférer avec la nouvelle.
  const activityToken = useRef(0);
  /** Véhicule personnel avec lequel on vient d'arriver : on reste dessus dans la rue et on repart avec, tant qu'on ne change pas de moyen de transport. */
  const [ridden, setRidden] = useState<'MOTO' | 'CAR' | null>(null);

  /** Trajet : le serveur valide et débite ; la ville anime le trajet sur la carte, puis on arrive. */
  const go = useCallback(
    async (to: string, mode: TransportMode) => {
      const from = state.location;
      const token = ++activityToken.current;
      const aborted = () => activityToken.current !== token;
      if (mode !== 'MOTO' && mode !== 'CAR') setRidden(null);
      const r = await run(
        () => travel(to, mode),
        (res) => {
          const name = to === HOME ? t('home.title') : localName(venueById.get(to) ?? { nameFr: to, nameEn: to }, i18n.language);
          const paid = BigInt(res.result.paid || '0');
          const own = mode === 'MOTO' || mode === 'CAR';
          const base = own
            ? t('travel.ownArrived', { place: name, mode: t(`transport.${mode}`), l: ((res.result.fuelUsedMl ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) })
            : paid > 0n
              ? t('travel.paid', { place: name, mode: t(`transport.${mode}`), price: fcfa(res.result.paid) })
              : t('travel.walked', { place: name });
          const full = res.result.shiftEnded ? `${base} ${t('travel.shiftEnded')}` : base;
          if (res.result.breakdown) return `${full} ${t('travel.breakdown')}`;
          return res.result.incident ? `${full} ${t('travel.incident')}` : full;
        },
      );
      if (!r || aborted()) return;
      setPicked(null);
      setTravelling(true);
      setCityStart(from);
      setView('map');
      setOnBus(mode === 'BUS' || mode === 'WORO');
      setRideVehicle(mode === 'WORO' ? 'taxi' : 'bus');
      setBusAbove(false);
      // La ville peut être en cours de montage ou de réveil (départ depuis un intérieur) : on attend qu'elle soit
      // active (placée devant le lieu de départ) avant de lancer le trajet.
      for (let i = 0; i < 300 && (i < 2 || !city.current); i++) await new Promise((ok) => requestAnimationFrame(ok));
      if (aborted()) return;
      city.current?.setHidden(mode === 'BUS' || mode === 'WORO');
      // Ma moto : même rendu que le zém, avec le joueur au guidon
      if (mode === 'MOTO') city.current?.setOwnMoto(true);
      await city.current?.travel(to, mode === 'MOTO' ? 'ZEM' : mode);
      // Une autre activité (course, livraison, ambulance…) a pris le dessus pendant ce trajet : elle gère déjà
      // la vue et la position, on ne doit pas revenir dessus ni la déplacer vers `to`.
      if (aborted()) return;
      if (mode === 'MOTO') city.current?.setOwnMoto(false);
      if (mode === 'MOTO' || mode === 'CAR') setRidden(mode);
      city.current?.setHidden(false);
      setOnBus(false);
      setCityStart(to);
      setTravelling(false);
      // Le serveur fait foi : on relit le personnage, et la vue suit le lieu réel (jamais « chez moi » si le serveur dit ailleurs)
      const real = await getCharacter().then((s) => (apply(s), s.location), () => to);
      if (aborted()) return;
      setView(viewFor(real));
      const v = venueById.get(to);
      if (v) speak(`${localName(v, i18n.language)}. ${i18n.language === 'en' ? v.descEn : v.descFr}`, i18n.language);
    },
    [run, t, venueById, i18n.language, state.location, apply],
  );

  /** Lieu qu'on vient de quitter : s'en éloigner réarme l'entrée automatique. */
  const noAuto = useRef<string | null>(null);
  /** Sortir d'un intérieur ou de la maison : la rue, devant la porte. */
  const goOutside = () => {
    // On vient de sortir : pas de ré-entrée automatique tant qu'on ne s'est pas éloigné de la porte
    noAuto.current = state.location;
    noAutoSeen.current = false;
    setCityStart(state.location);
    setView('street');
    window.setTimeout(() => city.current?.placeAt(state.location), 0);
  };

  /** Séance de zém : on choisit d'abord la moto (Gozem, la sienne, ou confiée par un propriétaire). */
  const [zemSheet, setZemSheet] = useState(false);
  // Arrivé au lieu de travail : le service demandé plus tôt (course de zém, livraison…) démarre tout seul
  useEffect(() => {
    const p = pendingWork.current;
    if (!p) return;
    if (Date.now() - p.at > 15 * 60_000) {
      pendingWork.current = null;
      return;
    }
    if (state.location === p.place && !travelling && !state.sleep && !state.hospital) {
      pendingWork.current = null;
      p.retry();
    }
  }, [state.location, travelling, state.sleep, state.hospital]);
  const mainWork = () => {
    if (state.job && wait <= 0) {
      if (state.job.id === 'zem_driver' && state.zemBike) setZemSheet(true);
      else void run(() => startShift('job'), (r) => t('work.shiftStarted', { n: r.result.missions }));
    } else openApp('work');
  };

  const shift = state.shift;
  const mission = shift?.orders.find((o) => o.status === 'open') ?? null;
  const placeLabel = (id?: string) => (id ? localName(venueById.get(id) ?? { nameFr: id, nameEn: id }, i18n.language) : '');
  const [riding, setRiding] = useState(false);
  /** Le livreur ou le zémidjan a laissé son poste pour une livraison ou une course : il y retourne à moto quand le service se termine. */
  const deliveredAway = useRef(false);
  // Entrée automatique : arriver devant l'entrée d'un lieu (ou de la maison) y fait entrer, sans appuyer sur « Entrer »
  const autoTried = useRef<string | null>(null);
  const noAutoSeen = useRef(false);
  useEffect(() => {
    if (view !== 'street') return;
    // Lieu qu'on vient de quitter : on ne le ré-ouvre qu'après s'en être éloigné
    if (arrive === noAuto.current) noAutoSeen.current = true;
    else if (noAutoSeen.current || arrive !== null) {
      noAuto.current = null;
      noAutoSeen.current = false;
    }
    if (arrive === null) {
      autoTried.current = null;
      return;
    }
    // Pas d'entrée automatique en service (livreur, zémidjan : on s'arrête souvent devant un lieu sans vouloir y entrer), ni sur son
    // propre véhicule, ni pendant le retour au poste : on n'entre que si l'on est venu à pied jusqu'à la porte
    if (shift || ridden || deliveredAway.current) return;
    if (travelling || riding || busy || onBus || picked || arrive === noAuto.current || autoTried.current === arrive) return;
    const timer = window.setTimeout(() => {
      autoTried.current = arrive;
      if (arrive === state.location) {
        if (INTERIOR_OF[arrive] || arrive === HOME) setView(viewFor(arrive));
      } else void go(arrive, 'WALK');
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [view, arrive, travelling, riding, busy, onBus, picked, state.location, go, shift, ridden]);
  /** Mission acceptée : une course de zém s'anime jusqu'à la destination, puis on est payé. */
  // Course ou livraison en cours : quitter la rue (maison, intérieur) l'annule, sinon le trajet restait suspendu
  // avec la ville en pause et les boutons de la mission grisés pour de bon. La mission reste proposée.
  // Jeton partagé par toute activité qui déplace le personnage (trajet libre, course, livraison) : en démarrer
  // une nouvelle invalide celle en cours, qui s'arrête proprement au lieu d'interférer avec la nouvelle.
  useEffect(() => {
    if (!riding || view === 'street' || view === 'map') return;
    activityToken.current++;
    city.current?.stopTravel();
    city.current?.setCargo(false);
    city.current?.setOwnMoto(false);
    setRiding(false);
  }, [view, riding]);
  const answer = async (accept: boolean) => {
    if (!shift || !mission) return;
    if (accept && (mission.kind === 'ride' || mission.kind === 'delivery') && mission.to) {
      const token = ++activityToken.current;
      const aborted = () => activityToken.current !== token;
      setRiding(true);
      // On voit la course : dans la rue, même si l'on était dans un intérieur ou sur la carte
      if (view !== 'street') {
        setCityStart(state.location);
        setView('street');
        for (let i = 0; i < 300 && (i < 2 || !city.current); i++) await new Promise((ok) => requestAnimationFrame(ok));
        city.current?.placeAt(state.location);
      }
      if (mission.kind === 'delivery') {
        // Livraison : le livreur conduit seul sa moto ; il va chercher le colis et le dépose, puis attend la suivante sur place
        city.current?.setOwnMoto(true);
        if (mission.from && mission.from !== state.location) await city.current?.travel(mission.from, 'ZEM', { roadside: true });
        if (aborted()) return;
        city.current?.setCargo(true);
        // Livraison : le livreur s'arrête au bord de la route près du lieu ; un employé du lieu emporte le colis à l'entrée
        await city.current?.travel(mission.to, 'ZEM', { roadside: true });
        if (aborted()) return;
        city.current?.dropParcel(mission.to);
        city.current?.setCargo(false);
        toast(t('work.delivered', { place: placeLabel(mission.to) }), 'ok');
        city.current?.setOwnMoto(false);
        deliveredAway.current = true;
      } else {
        // Course de zém : le joueur conduit, le client est assis derrière lui
        city.current?.setOwnMoto(true, true);
        // Course : la moto s'arrête sur la route près du lieu ; le client descend et marche jusqu'à l'entrée
        await city.current?.travel(mission.to, 'ZEM', { roadside: true });
        if (aborted()) return;
        city.current?.dropPassenger(mission.to);
        city.current?.setOwnMoto(false);
        deliveredAway.current = true;
      }
    }
    // Métier à pied : le client est servi sous nos yeux (geste du métier) avant d'être payé
    if (accept && stationJob && view === 'street') await city.current?.performWork();
    else if (accept && stationJob && view === 'inside') await interior.current?.performWork();
    await run(
      () => serveMission(shift.id, mission.id, accept),
      (r) =>
        accept
          ? r.result.incident
            ? t('work.incident')
            : r.result.paid === 0 && state.job?.payMode === 'MONTHLY' && shift.kind === 'job'
              ? t('work.servedMonthly')
              : t('work.missionPaid', { amount: fcfa(r.result.paid) })
          : null,
    );
    // Le zém et le livreur restent là où ils ont déposé client ou colis : la course suivante part de là
    if (accept && (mission.kind === 'ride' || mission.kind === 'delivery')) setRiding(false);
  };
  // Toutes les livraisons ou courses faites (plus de mission ouverte, ou service arrêté) : il rentre à son poste
  useEffect(() => {
    if (riding || (shift && mission) || !deliveredAway.current) return;
    // Le retour reste en attente tant qu'on n'est pas dans la rue (téléphone, carte, intérieur) : il part dès qu'on y revient,
    // au lieu d'être oublié
    if (view !== 'street' || !city.current) return;
    deliveredAway.current = false;
    // Déjà devant le poste : aucun trajet (un trajet de quelques mètres faisait tourner le personnage en rond)
    if (city.current.isNear(state.location, 9)) return;
    // Le poste de service est le lieu du service (c'est là qu'on lance la séance) : la moto y revient après la dernière livraison
    toast(t('work.returning', { place: placeLabel(state.location) }), 'info');
    void (async () => {
      setRiding(true);
      city.current?.setOwnMoto(true);
      await city.current?.travel(state.location, 'ZEM');
      city.current?.setOwnMoto(false);
      setRiding(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, mission?.id, riding, view, cityReady]);
  // Métier à pied : on le voit au travail, avec son poste (étal, comptoir, fauteuil…), dans la rue devant le lieu
  const interior = useRef<InteriorHandle>(null);
  playConsultRef.current = (phases, onDone) => {
    if (INTERIOR_OF[state.location] !== 'clinic') return;
    setPhoneOpen(false);
    const detail: ConsultDetail = { labels: { examine: t('consult.examine'), results: t('consult.results'), prescription: t('consult.prescription') }, phases, onDone };
    void (async () => {
      const wasInside = view === 'inside';
      if (!wasInside) setView('inside');
      // La pièce se monte juste après le changement de vue : on attend qu'elle soit prête avant de jouer la scène
      for (let i = 0; i < 180 && !interior.current; i++) await new Promise((ok) => requestAnimationFrame(ok));
      await new Promise((ok) => window.setTimeout(ok, wasInside ? 250 : 900));
      window.dispatchEvent(new CustomEvent(CONSULT_EVENT, { detail }));
    })();
  };
  const stationJob = shift ? (shift.kind === 'company' ? DESK : stationOf(shift.sourceId)) : null;
  useEffect(() => {
    // Un métier de comptoir ou de bureau se fait dans la pièce ; les autres (étal, voiture, fauteuil…) dans la rue
    if (stationJob && !travelling && view === 'inside' && !INDOOR_JOBS.has(stationJob)) goOutside();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationJob, view, travelling]);
  useEffect(() => {
    // Un court délai : la scène a d'abord placé le joueur devant le lieu, le poste s'installe à cet endroit. La scène de la
    // ville se charge à la demande : après un rechargement en plein service, on attend qu'elle existe (sinon pas de poste)
    const want = (view === 'street' || view === 'map') && !travelling ? stationJob : null;
    let tries = 0;
    const id = window.setInterval(() => {
      if (++tries < 2) return;
      if (city.current || tries > 100) {
        window.clearInterval(id);
        city.current?.setWork(want);
        // Le client annoncé avant l'installation du poste est repris par le poste (la voiture du client, au lavage)
        if (want && mission) city.current?.setCustomer(view === 'street' && !riding, mission.kind === 'delivery', mission.id);
      }
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationJob, view, cityReady, travelling]);
  // Un nouveau client s'approche à chaque mission ouverte (dans la rue)
  useEffect(() => {
    city.current?.setCustomer(!!mission && view === 'street' && !riding, mission?.kind === 'delivery', mission?.id);
  }, [mission?.id, view, riding, mission]);
  // Course ou livraison proposée : le zém attend déjà sur sa moto (elle ne doit pas n'apparaître qu'au départ)
  useEffect(() => {
    const on = !!mission && (mission.kind === 'ride' || mission.kind === 'delivery') && view === 'street' && !riding && !travelling;
    const id = window.setTimeout(() => city.current?.setDutyMoto(on), 150);
    return () => window.clearTimeout(id);
  }, [mission?.id, mission?.kind, view, riding, travelling, cityReady]);
  // Dans la pièce : un client entre par la porte et vient au comptoir (la scène peut mettre un instant à se charger)
  useEffect(() => {
    const on = !!mission && view === 'inside' && !!stationJob && INDOOR_JOBS.has(stationJob);
    let tries = 0;
    const id = window.setInterval(() => {
      if (interior.current || ++tries > 30) {
        window.clearInterval(id);
        interior.current?.setCustomer(on);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [mission?.id, view, stationJob, mission]);
  const missionText = (m: NonNullable<typeof mission>) =>
    m.kind === 'ride'
      ? t('work.mission.ride', { from: placeLabel(m.from), to: placeLabel(m.to) })
      : m.kind === 'delivery'
        ? t('work.mission.delivery', { item: t(`work.parcels.${m.item}`), from: placeLabel(m.from), to: placeLabel(m.to) })
        : m.kind === 'wash'
        ? t(`work.mission.${m.item}`)
        : t('work.mission.sale', { qty: m.qty, item: t(`work.items.${m.item}`, { count: m.qty }) });
  const shiftTitle = shift
    ? shift.kind === 'company'
      ? state.company?.name ?? ''
      : state.job
        ? localName(state.job, i18n.language)
        : ''
    : '';

  const activities = here?.activities ?? [];
  // Heures d'ouverture : heure de jeu courante (mise à jour à chaque rendu de l'horloge)
  const hourNow = clock.parts().hour;
  const openLabel = (id: string) => {
    const h = catalog?.hours[id];
    if (!h || (h[0] === 0 && h[1] === 24)) return t('hours.always');
    return isOpenAt(h, hourNow) ? t('hours.openUntil', { time: hhmm(h[1] % 24, 0) }) : t('hours.closedUntil', { time: hhmm(h[0], 0) });
  };
  const closedHere = !!here && !isOpenAt(catalog?.hours[here.id], hourNow);
  const [catalogOpen, setCatalogOpen] = useState(false);
  /** Panneau du lieu réduit à son en-tête pour dégager la vue du jeu. */
  const [panelMin, setPanelMin] = useState(false);
  /** Aménagement du logement : meubles du joueur, feuille « Aménager » ouverte, meuble en réglage et position en attente de validation. */
  const [homeFurn, setHomeFurn] = useState<HomeFurnitureView | null>(null);
  const [homeFurnTried, setHomeFurnTried] = useState(false);
  const [decorOpen, setDecorOpen] = useState(false);
  const [decorSel, setDecorSel] = useState<string | null>(null);
  const [decorPending, setDecorPending] = useState<{ id: string; x: number; z: number; rot: number } | null>(null);
  // Liste mémorisée : la pièce n'est reconstruite que si un meuble change, pas à chaque rafraîchissement de l'écran
  const furnItems = useMemo(() => (view === 'home' ? furnitureItems(homeFurn, decorPending) : []), [view, homeFurn, decorPending]);
  const loadHomeFurn = useCallback(async () => {
    try {
      setHomeFurn(await getHomeFurniture());
    } catch {
      /* hors ligne : la maison reste meublée d'origine */
    }
  }, []);
  useEffect(() => {
    if (view === 'home') {
      // La pièce n'est montée qu'une fois les meubles connus : leur mode (d'origine ou à soi) ne change pas en cours de route
      setHomeFurnTried(false);
      void loadHomeFurn().finally(() => setHomeFurnTried(true));
    } else {
      setDecorOpen(false);
      setDecorSel(null);
      setDecorPending(null);
    }
  }, [view, state.housing, loadHomeFurn]);
  /** Téléphone : seules les 2 premières actions sont montrées, le reste derrière « Plus ». */
  const [chipsAll, setChipsAll] = useState(false);
  /** Fiche de la séance de travail réduite à son en-tête ; elle se rouvre à chaque nouveau client. */
  const [missionMin, setMissionMin] = useState(false);
  useEffect(() => setMissionMin(false), [mission?.id]);
  const [homeAct, setHomeAct] = useState<HomeAct | null>(null);
  useEffect(() => {
    const on = (e: Event) => setHomeAct((e as CustomEvent<HomeAct | null>).detail);
    window.addEventListener(HOME_ACT_STATE, on);
    return () => window.removeEventListener(HOME_ACT_STATE, on);
  }, []);
  // Musique de la maison : s'arrête seule dès qu'on quitte la maison, qu'on dort ou qu'on fait autre chose
  // Télé, lecture, musique : durent tant qu'on veut, et s'arrêtent d'elles-mêmes dès qu'on quitte la maison ou qu'on dort
  // Pendant une activité (télé, lecture, musique, douche) le panneau se replie pour laisser voir le personnage ; il se rouvre à la fin
  useEffect(() => {
    setPanelMin(!!homeAct);
  }, [homeAct]);
  const stopHomeAct = () => {
    if (homeAct === 'music') stopMusic();
    window.dispatchEvent(new Event(HOME_STOP_EVENT));
  };
  useEffect(() => {
    if (homeAct && (view !== 'home' || state.sleep)) {
      if (homeAct === 'music') stopMusic();
      window.dispatchEvent(new Event(HOME_STOP_EVENT));
      setHomeAct(null);
    }
  }, [homeAct, view, state.sleep]);
  useEffect(() => {
    const on = () => toast(t('voice.none'), 'info');
    window.addEventListener(NO_VOICE_EVENT, on);
    return () => window.removeEventListener(NO_VOICE_EVENT, on);
  }, [toast, t]);
  const [, musicTick] = useState(0);
  useEffect(() => onMusicChange(() => musicTick((n) => n + 1)), []);
  const [catalogQuery, setCatalogQuery] = useState('');
  const balance = BigInt(state.wallet.balance);
  // AMU : dans un hôpital conventionné, l'assuré ne paie que sa part (le serveur applique le même calcul)
  const amuHere = state.amu.covered && state.amu.hospitals.includes(state.location);
  const costOf = (p: number) => (amuHere ? p - Math.floor((p * state.amu.coverageBp) / 10_000) : p);
  // Lieu de partenaire : décor de marque et articles exposés dans l'intérieur (toucher un étal l'achète)
  const interiorBrand = useMemo<InteriorBrand | null>(() => {
    if (!here || !here.id.startsWith('brand_')) return null;
    const p = places.find((x) => x.x === here.x && x.z === here.z);
    if (!p) return null;
    return { label: p.label, color: p.color, model: p.model, logo: p.logo, articles: here.activities.map((a) => ({ emoji: a.emoji, name: localName(a, i18n.language), price: a.price > 0 ? fcfa(a.price) : t('venue.free') })) };
  }, [here, places, i18n.language, t]);
  const buyArticle = (i: number) => {
    const a = here?.activities[i];
    if (!a || busy) return;
    void run(() => doActivity(a.id), () => t('venue.done', { activity: `${a.emoji} ${localName(a, i18n.language)}`, price: a.price > 0 ? fcfa(a.price) : t('venue.free') }));
  };
  const inCity = view === 'map' || view === 'street';
  useEffect(() => {
    const atStation = view === 'street' && !travelling && !state.sleep && stationIds.includes(state.location);
    const kind = atStation ? (state.hasMoto ? 'MOTO' : state.hasCar ? 'CAR' : null) : null;
    // Hors station : on reste sur sa moto (ou en voiture) après un trajet ; les bâtiments, le sommeil ou un autre moyen de transport l'enlèvent
    const parked = !atStation && view === 'street' && !travelling && !state.sleep && ((ridden === 'MOTO' && state.hasMoto) || (ridden === 'CAR' && state.hasCar)) ? ridden : null;
    // La ville se place devant le lieu juste après le changement de vue : on attend un instant avant de poser la scène
    // (au rechargement la ville peut ne pas être prête : on réessaie, l'appel est sans effet s'il est déjà posé)
    const hasVeh = view === 'street' && (state.hasMoto || state.hasCar);
    const apply = (): void => {
      city.current?.setStation(kind, state.location);
      city.current?.setRidden(parked);
      // Moto et voiture garées devant la maison : on s'en approche pour monter
      city.current?.setParkedVehicles({ MOTO: !!state.hasMoto, CAR: !!state.hasCar });
    };
    const ids = (kind || parked || hasVeh ? [700, 2000, 4500] : [0]).map((d) => window.setTimeout(apply, d));
    // La ville est reconstruite quand un réglage change (annonces, marques, qualité…) : le joueur revient alors à l'entrée.
    // On repose donc la scène régulièrement ; l'appel ne fait rien tant qu'elle est déjà en place.
    const watch = kind || parked || hasVeh ? window.setInterval(apply, 1200) : 0;
    return () => {
      ids.forEach((i) => window.clearTimeout(i));
      if (watch) window.clearInterval(watch);
    };
  }, [view, travelling, state.sleep, state.location, state.hasMoto, state.hasCar, stationIds, ridden]);
  // Bruit de la rue coupé dès qu'on n'est plus dans la rue (bâtiment, maison, carte, région)
  useEffect(() => {
    setStreetIndoors(view === 'inside' || view === 'home');
    if (view !== 'street') updateStreetSound(0, 0, false);
  }, [view]);
  // Joueurs présents dans le même lieu (pas le domicile : chacun a le sien)
  const lv = useLive();
  const hereNow = !inCity && view !== 'home' ? lv.players.filter((p) => p.place === state.location) : [];
  // Joueur croisé (à quelques mètres en ville, ou dans le même lieu) : on peut discuter avec lui
  const [dmPeer, setDmPeer] = useState<{ id: string; name: string } | null>(null);
  const [dmToast, setDmToast] = useState<DmMsg | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const nearby = (() => {
    void tick;
    if (hereNow.length > 0) return hereNow[0]!;
    if (!inCity) return null;
    const me = myPosition();
    if (Number.isNaN(me.x)) return null;
    let best: (typeof lv.players)[number] | null = null;
    let bd = 6;
    for (const p of lv.players) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < bd) [best, bd] = [p, d];
    }
    return best;
  })();
  useEffect(() => live.onDm((m) => { setDmToast(m); speak(t('dm.spoken', { name: m.from.name, text: m.text }), i18nLang.current, { queue: true }); }), [t]);
  // Virements reçus pendant l'absence : annoncés une fois à l'ouverture de la partie (repère = dernier virement vu)
  useEffect(() => {
    const key = `agbe.transferSeen.${initialState.id}`;
    void getHistory(15).then((rows) => {
      const incoming = rows.filter((r) => r.kind === 'TRANSFER' && BigInt(r.amount) > 0n);
      let seen: string | null = null;
      try { seen = window.localStorage.getItem(key); } catch { /* stockage indisponible */ }
      const newest = incoming[0];
      if (!newest) return;
      try { window.localStorage.setItem(key, newest.at); } catch { /* idem */ }
      if (!seen) return; // première ouverture sur cet appareil : on ne rejoue pas tout l'historique
      const fresh = incoming.filter((r) => r.at > seen!);
      if (fresh.length === 0) return;
      const total = fresh.reduce((sum, r) => sum + BigInt(r.amount), 0n);
      toast(t('wallet.receivedWhileAway', { count: fresh.length, amount: fcfa(total.toString()) }), 'info');
    }, () => undefined);
  }, [initialState.id, toast, t]);
  // Argent reçu d'un autre joueur : notification (lue à voix haute) et solde rafraîchi
  useEffect(() => live.onMoney((m) => {
    toast(t('wallet.received', { amount: fcfa(m.amount), from: m.from }), 'info');
    void getCharacter().then(apply, () => undefined);
  }), [t, toast, apply]);
  // Résultat d'un marché public : retenue, rejetée, ou payée (le montant touche alors le solde).
  useEffect(() => live.onTender((e) => {
    const a = catalog?.company.activities.find((x) => x.id === e.sector);
    const sector = a ? localName(a, i18n.language) : e.sector;
    const msg = e.kind === 'awarded' ? t('tenders.toastAwarded', { sector }) : e.kind === 'rejected' ? t('tenders.toastRejected', { sector }) : t('tenders.toastPaid', { amount: fcfa(e.amount) });
    toast(msg, e.kind === 'rejected' ? 'info' : 'ok', 'tenders');
    if (e.kind === 'paid') void getCharacter().then(apply, () => undefined);
  }), [t, toast, apply, catalog, i18n.language]);
  // Évènement sur mon prêt bancaire personnel : accordé, mensualité prélevée, en retard, ou clos.
  useEffect(() => live.onLoan((e) => {
    const msg =
      e.kind === 'granted' ? t('loans.toastGranted', { amount: fcfa(e.amount) }) :
      e.kind === 'collected' ? t('loans.toastCollected', { amount: fcfa(e.amount) }) :
      e.kind === 'late' ? t('loans.toastLate') :
      t('loans.toastClosed');
    toast(msg, e.kind === 'late' ? 'error' : 'info', 'bank');
    void getCharacter().then(apply, () => undefined);
  }), [t, toast, apply]);
  useEffect(() => {
    if (!dmToast) return;
    const id = window.setTimeout(() => setDmToast(null), 10_000);
    return () => window.clearTimeout(id);
  }, [dmToast]);
  // Hors de Lomé (ou en car) : vue en liste de la ville, sans scène 3D
  const inRegion = (state.city ?? 'lome') !== 'lome' || !!(state.trip && new Date(state.trip.until).getTime() > Date.now());
  // Passage maison ↔ ville : un voile couvre l'échange de scène avant l'affichage, puis s'efface en douceur
  const [veil, setVeil] = useState<'on' | 'fading' | null>(null);
  const firstScene = useRef(true);
  useLayoutEffect(() => {
    if (firstScene.current) {
      firstScene.current = false;
      return;
    }
    setVeil('on');
    let cancelled = false;
    let frames = 0;
    // Quelques images pour que la nouvelle scène soit dessinée, puis fondu
    const tick = () => {
      if (cancelled) return;
      if (++frames < 4) return void requestAnimationFrame(tick);
      setVeil('fading');
      window.setTimeout(() => !cancelled && setVeil(null), 700);
    };
    const id = window.setTimeout(() => requestAnimationFrame(tick), 180);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [inCity]);
  // Lancement : un écran de chargement opaque couvre le HUD jusqu'à ce que la première scène soit dessinée, puis s'efface
  const [boot, setBoot] = useState<'on' | 'fading' | null>('on');
  const booted = useRef(false);
  const sceneShown = useCallback(() => {
    if (booted.current) return;
    booted.current = true;
    let frames = 0;
    const tick = () => {
      if (++frames < 4) return void requestAnimationFrame(tick);
      setBoot('fading');
      window.setTimeout(() => setBoot(null), 600);
    };
    requestAnimationFrame(tick);
  }, []);
  useEffect(() => {
    // Catalogue injoignable : on ne bloque pas le joueur derrière l'écran de chargement
    const id = window.setTimeout(() => setBoot((b) => (b === 'on' ? null : b)), 15_000);
    return () => window.clearTimeout(id);
  }, []);
  const interiorKind: InteriorKind = view === 'home' ? (state.housing as InteriorKind) : INTERIOR_OF[state.location] ?? 'office';
  useEffect(() => {
    if (!picked) setWorkGoing(null);
  }, [picked]);
  const pickedVenue = picked && picked !== HOME ? venueById.get(picked) ?? null : null;

  return (
    <Ctx.Provider value={ctx}>
      <div className={`game view-${view}${names ? '' : ' names-off'}`}>
        {boot && (
          <div className={`game-boot${boot === 'fading' ? ' fading' : ''}`} aria-hidden={boot === 'fading'}>
            <Splash />
          </div>
        )}
        {veil && (
          <div className={`scene-veil${veil === 'fading' ? ' fading' : ''}`} aria-hidden="true">
            <div className="veil-logo" />
            <small>{inCity ? t('veil.city') : t('veil.home')}</small>
          </div>
        )}
        <ShiftEnd active={!!shift} onEnd={() => city.current?.placeAt(state.location)} />
        <Suspense fallback={<div className="scene loading"><Splash /></div>}>
          {catalog && (inRegion || !inCity || cityReady) && <SceneReady onReady={sceneShown} />}
          {catalog && inRegion && <RegionView />}
          {catalog && cityReady && !inRegion && (
            <CityScene
              ref={city}
              active={inCity}
              quality={quality}
              clock={clock}
              venues={cityVenues}
              home={cityHome}
              look={look}
              ads={ads}
              busLines={busLines}
              view={view === 'map' ? 'map' : 'street'}
              startAt={cityStart}
              powerCut={!!state?.outages?.power}
              onPick={(id) => setPicked(id)}
              onNear={setNear}
              onArrive={setArrive}
              onBillboard={openBoard}
              onFreeBoard={setFreeSlot}
              brands={brands}
              vipSpots={vipSpots}
              onVipSpot={openVip}
              boardsVisible={boardsOn}
              sea={sea}
              land={landZones}
              onLandCell={(zoneId, cell) => { setLandFocus({ zoneId, cell }); openApp('estate'); }}
              onSeaCell={onSeaCell}
              zones={adZones}
              onPlot={onPlot}
              onBrand={openBrand}
            />
          )}
          {catalog && onBus && !busAbove && <Suspense fallback={null}><BusRideScene quality={quality} look={look} clock={clock} vehicle={rideVehicle} /></Suspense>}
          {catalog && !inCity && !inRegion && (view !== 'home' || homeFurnTried) && <InteriorScene ref={interior} work={view === 'inside' && stationJob && INDOOR_JOBS.has(stationJob) ? stationJob : null} key={`${view}-${state.location}`} quality={quality} kind={interiorKind} look={look} open={view === 'home' || !closedHere} clock={clock} asleep={!!state.sleep} onExit={goOutside} brand={view === 'inside' ? interiorBrand : null} onArticle={buyArticle} furniture={furnItems} furnitureSelected={view === 'home' && decorOpen ? decorSel : null} custom={view === 'home' && !!homeFurn?.custom} />}
          {!inRegion && !dmPeer && (dmToast || nearby) && (
            <div className="meet-bubble" role="status">
              {dmToast ? (
                <>
                  <span>💬 <b>{dmToast.from.name}</b> : {dmToast.text}</span>
                  <button className="btn primary small" aria-label={t('dm.reply')} onClick={() => { setDmPeer(dmToast.from); setDmToast(null); }}><span aria-hidden="true">💬</span><span className="meet-label"> {t('dm.reply')}</span></button>
                </>
              ) : (
                nearby && (
                  <>
                    <span>👋 {t('dm.near', { name: nearby.name })}</span>
                    <button className="btn primary small" aria-label={t('dm.talk')} onClick={() => setDmPeer({ id: nearby.id, name: nearby.name })}>
                      💬<span className="meet-label"> {t('dm.talk')}</span>
                      {(lv.dmUnread[nearby.id] ?? 0) > 0 && <span className="badge">{lv.dmUnread[nearby.id]}</span>}
                    </button>
                  </>
                )
              )}
            </div>
          )}
          {dmPeer && <DmPanel peer={dmPeer} onClose={() => setDmPeer(null)} />}
          {hereNow.length > 0 && !inRegion && (
            <div className="here-players" role="status">
              <span>{t('live.hereToo', { count: hereNow.length })}</span>
              {hereNow.slice(0, 8).map((p) => <span key={p.id} className="player-chip">{p.name}</span>)}
            </div>
          )}
        </Suspense>

        <div className="hud-top">
          <TopBar place={travelling ? t('travel.onTheWay') : view === 'map' ? t('nav.map') : placeName} />
          {(() => {
            const rentLate = state.rent.overdue || state.rent.homeless || BigInt(state.rent.debt) > 0n;
            const billsLate = !state.rent.homeless && (state.bills.ELEC.overdue || state.bills.WATER.overdue);
            const n = Number(rentLate) + Number(billsLate);
            // AMU échue : une pastille rouge discrète (le message parlé suffit), pas de bandeau qui couvre l'écran
            const amuOff = !state.amu.covered;
            if (n === 0 && !amuOff) return null;
            const label = n > 1 ? t('hud.urgent', { count: n }) : rentLate ? (state.rent.homeless ? t('hud.rentHomeless') : state.rent.overdue ? t('hud.rentLate') : t('hud.rentDebt')) : t('hud.billsOverdue');
            return (
              <div className="hud-tags">
                {amuOff && (
                  <button className="alert-rent alert-amu" onClick={() => (focusSection('amu'), openApp('health'))} title={t('hud.amuOff')} aria-label={t('hud.amuOff')}>
                    🩺 {t('hud.amuTag')}
                  </button>
                )}
                {n > 0 && (
                  <button className="alert-rent" onClick={() => (!rentLate && focusSection('bills'), openApp('rent'))}>
                    {rentLate ? '⚠️' : '⚡'} {label}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
        {/* Cloche des notifications : à droite, au milieu de l'écran ; absente tant qu'il n'y a rien, pastille rouge avec le nombre sinon,
            elle s'agite tant qu'il y a du nouveau. Un appui ouvre le téléphone sur le centre de notifications. */}
        {!phoneOpen && notifications.length > 0 && createPortal(
          <button
            type="button"
            className={`notif-bell${notifications.length > 0 ? ' has' : ''}${notifNew ? ' new' : ''}${view === 'home' || view === 'inside' ? ' up' : ''}`}
            onClick={() => (focusSection('notifications'), openApp(null))}
            aria-label={notifications.length > 0 ? t('bell.some', { count: notifications.length }) : t('bell.none')}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M12 3a6 6 0 0 0-6 6v3.6c0 .7-.3 1.4-.8 1.9L4 16h16l-1.2-1.5a3 3 0 0 1-.8-1.9V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {notifications.length > 0 && <em>{notifications.length > 9 ? '9+' : notifications.length}</em>}
          </button>,
          document.body,
        )}
        {/* Chat sur le côté : bouton 💬 au bord droit (sous la cloche), panneau qui glisse depuis la droite */}
        {!phoneOpen && !sideChat && createPortal(
          (() => {
            const n = lvAlerts.unread + Object.values(lvAlerts.dmUnread).reduce((a, b) => a + b, 0);
            return (
              <button type="button" className="side-chat-btn" onClick={() => setSideChat(true)} aria-label={t('chat.sideOpen')} title={t('chat.sideOpen')}>
                <span aria-hidden="true">💬</span>
                {n > 0 && <em>{n > 9 ? '9+' : n}</em>}
              </button>
            );
          })(),
          document.body,
        )}
        {sideChat && !phoneOpen && createPortal(
          <aside className="side-chat" role="dialog" aria-label={t('chat.side')}>
            <header className="side-chat-head">
              <span className="side-chat-logo" aria-hidden="true">💬</span>
              <span className="side-chat-title">
                <strong>{t('chat.side')}</strong>
                <small>{t('chat.online', { n: lvAlerts.online })}</small>
              </span>
              <button type="button" onClick={() => setSideChat(false)} aria-label={t('chat.sideClose')}>✕</button>
            </header>
            <div className="side-chat-body"><ChatApp /></div>
          </aside>,
          document.body,
        )}
        {rentAlert && (
          <div className="rent-alert" role="alertdialog" aria-labelledby="rent-alert-title">
            <strong id="rent-alert-title">🏠 {t('rentAlert.title')}</strong>
            <p>{rentAlert}</p>
            <div className="row">
              <button className="btn primary" onClick={() => (setRentAlert(null), openApp('rent'))}>{t('rentAlert.open')}</button>
              <button className="btn ghost" onClick={() => setRentAlert(null)}>{t('rentAlert.later')}</button>
            </div>
          </div>
        )}
        {billAlert && !rentAlert && (
          <div className="rent-alert" role="alertdialog" aria-labelledby="bill-alert-title">
            <strong id="bill-alert-title">⚡ {t('billAlert.title')}</strong>
            <p>{billAlert}</p>
            <div className="row">
              <button className="btn primary" onClick={() => (setBillAlert(null), focusSection('bills'), openApp('rent'))}>{t('billAlert.pay')}</button>
              <button className="btn ghost" onClick={() => setBillAlert(null)}>{t('rentAlert.later')}</button>
            </div>
          </div>
        )}
        <div className="hud-left" ref={hudLeft}>
          <Stats />
          {!state.job && (
            <button className="task" onClick={() => openApp('work')}>
              <span aria-hidden="true">🎯</span>
              <span>
                <strong>{t('tasks.job')}</strong>
                <small>{t('tasks.jobHint')}</small>
              </span>
            </button>
          )}
          {state.job && (
            <button className="task alt" onClick={() => (focusSection('work-offers'), openApp('work'))} aria-label={t('tasks.otherJob')}>
              <span aria-hidden="true">🔎</span>
              <span><strong>{t('tasks.otherJob')}</strong></span>
            </button>
          )}
          {state.job && wait <= 0 && (
            <button className="task ready" disabled={busy} onClick={mainWork}>
              <span aria-hidden="true">💼</span>
              <span>
                <strong>{wait <= 0 ? t('work.workNow') : localName(state.job, i18n.language)}</strong>
                <small>{wait <= 0 ? (state.job.payMode === 'MONTHLY' ? t('tasks.workReadyMonthly') : t('tasks.workReady', { amount: fcfa(state.job.payPerShift) })) : t('tasks.workIn', { time: shortDuration(wait) })}</small>
              </span>
            </button>
          )}
        </div>

        {/* Séance de travail : un client à la fois, accepter ou refuser */}
        {shift && !travelling && view !== 'map' && (
          <div className={missionMin ? 'mission-panel min' : 'mission-panel'} role="region" aria-label={t('work.onDuty')}>
            <div className="pp-head">
              <span className="pp-emoji" aria-hidden="true">{shift.kind === 'company' ? '🏢' : '💼'}</span>
              <div className="pp-title">
                <strong>{t('work.onDuty')} · {shiftTitle}</strong>
                <small>{t('work.progress', { done: shift.orders.filter((o) => o.status !== 'open').length, total: shift.orders.length })}</small>
              </div>
              <button className="btn small ghost" disabled={busy} onClick={() => void run(stopShift, () => t('work.stopped'))}>{t('work.stop')}</button>
              {view === 'home' && homeAct && (
                <button className="btn small" onClick={stopHomeAct}>
                  ⏹ {t('music.pause')}
                </button>
              )}
              <button className="btn ghost pp-toggle" aria-expanded={!missionMin} aria-label={missionMin ? t('street.expand') : t('street.collapse')} onClick={() => setMissionMin((v) => !v)}>
                {missionMin ? t('street.show') : t('street.hide')}
              </button>
            </div>
            {!missionMin && (mission ? (
              <div className="customer">
                <span className="cust-avatar" aria-hidden="true">{mission.kind === 'delivery' ? '📦' : mission.kind === 'ride' ? '🧍🏾' : mission.kind === 'wash' ? '🚗' : '🧕🏾'}</span>
                <div className="cust-text">
                  <p>{missionText(mission)}</p>
                  <strong>{state.job?.payMode === 'MONTHLY' && shift?.kind === 'job' ? t('work.countsForSalary') : `${fcfa(mission.amount)}${mission.cost > 0 ? ` · ${t('work.costs2', { cost: fcfa(mission.cost) })}` : ''}`}</strong>
                </div>
                <div className="cust-actions">
                  <button className="btn primary" disabled={busy || riding} onClick={() => void answer(true)}>{mission.kind === 'ride' ? t('work.acceptRide') : mission.kind === 'delivery' ? t('work.acceptDelivery') : t('work.serve')}</button>
                  <button className="btn" disabled={busy || riding} onClick={() => void answer(false)}>{t('work.decline')}</button>
                </div>
              </div>
            ) : (
              <p className="ok">{t('work.allDone')}</p>
            ))}
          </div>
        )}

        {/* Panneau du lieu : maison, intérieur, ou rue (lieu atteint) */}
        {!travelling && !shift && view !== 'map' && !(view === 'home' && decorOpen) && (
          <div ref={placePanel} className={`place-panel${panelMin ? ' min' : ''}${chipsAll || view === 'home' ? ' all' : ''}`}>
            <div className="pp-head">
              <span className="pp-emoji" aria-hidden="true">{view === 'home' ? '🏠' : here?.emoji ?? '📍'}</span>
              <div className="pp-title">
                <strong>{view === 'street' && near && near !== state.location ? (near === HOME ? t('home.title') : localName(venueById.get(near) ?? { nameFr: '', nameEn: '' }, i18n.language)) : placeName}</strong>
                <small>
                  {view === 'home'
                    ? t(`housing.${state.housing}`)
                    : here
                      ? `${i18n.language === 'en' ? here.districtEn : here.districtFr} · ${openLabel(here.id)}`
                      : ''}
                </small>
              </div>
              {view === 'street' && near && near !== state.location ? (
                <button className="btn primary small" disabled={busy} onClick={() => void go(near, 'WALK')}>
                  {t('street.enter')}
                </button>
              ) : view === 'street' ? (
                INTERIOR_OF[state.location] || state.location === HOME ? (
                  <button className="btn primary small" onClick={() => setView(viewFor(state.location))}>
                    {t('street.goIn')}
                  </button>
                ) : null
              ) : (
                <button className="btn small" onClick={goOutside}>
                  🚪 {t('street.goOut')}
                </button>
              )}
              <button className="btn ghost small pp-toggle" aria-expanded={!panelMin} aria-label={panelMin ? t('street.expand') : t('street.collapse')} onClick={() => setPanelMin((v) => !v)}>
                {panelMin ? t('street.show') : t('street.hide')}
              </button>
            </div>
            <ul className="chips" hidden={panelMin}>
              {/* Sur le lieu de travail : un grand bouton pour commencer le service (ou le délai avant le prochain) */}
              {view !== 'home' && state.job && !shift && catalog?.workPlaces[state.job.id] === state.location && !(view === 'street' && near && near !== state.location) && (
                <li>
                  <button className="chip-act cta" disabled={busy || wait > 0} onClick={mainWork}>
                    <span className="ca-ico" aria-hidden="true">💼</span>
                    <span className="ca-txt">
                      <span className="ca-lbl">{wait > 0 ? t('tasks.workIn', { time: shortDuration(wait) }) : t('work.ctaTitle')}</span>
                      <small>{localName(state.job, i18n.language)}</small>
                    </span>
                    {wait <= 0 && (
                      <span className="ca-pay">
                        <b>{state.job.payMode === 'MONTHLY' ? t('work.ctaMonthly') : t('work.ctaEstimate', { amount: fcfa(state.job.payPerShift) })}</b>
                        <small>{t('work.ctaHint')}</small>
                      </span>
                    )}
                  </button>
                </li>
              )}
              {view === 'home' && (
                <>
                  <li>
                    <button className="chip-act" disabled={busy || (state.sleepPlan?.hours ?? null) === null} onClick={() => void run(sleep, () => t('sleep.started')).then((r) => r && window.dispatchEvent(new Event(SLEEP_EVENT)))}>
                      <span className="ca-ico" aria-hidden="true">🛏️</span>
                      <span className="ca-lbl">{t('sleep.night')}</span>
                      <b>{(state.sleepPlan?.hours ?? null) === null ? t('sleep.from', { h: state.sleepPlan?.fromHour ?? 20 }) : shortDuration(state.sleepPlan!.hours!)}</b>
                    </button>
                  </li>
                  <li>
                    <button className="chip-act" disabled={busy || state.nextRestInGameHours > 0} onClick={() => void run(rest, () => t('sleep.napStarted')).then((r) => r && window.dispatchEvent(new Event(SLEEP_EVENT)))}>
                      <span className="ca-ico" aria-hidden="true">😌</span>
                      <span className="ca-lbl">{t('sleep.nap')}</span>
                      <b>{state.nextRestInGameHours > 0 ? shortDuration(state.nextRestInGameHours) : t('venue.free')}</b>
                    </button>
                  </li>
                  {state.hasTv && (
                    <li>
                      <button className="chip-act" disabled={busy || state.nextTvInGameHours > 0} onClick={() => void run(watchTv, () => t('leisure.tvDone')).then((r) => r && playAct('tv'))}>
                        <span className="ca-ico" aria-hidden="true">📺</span>
                        <span className="ca-lbl">{t('leisure.tv')}</span>
                        <b>{state.nextTvInGameHours > 0 ? shortDuration(state.nextTvInGameHours) : t('venue.free')}</b>
                      </button>
                    </li>
                  )}
                  <li>
                    <button className="chip-act" disabled={busy || state.nextReadInGameHours > 0} onClick={() => void run(readBook, () => t('leisure.readDone')).then((r) => r && playAct('read'))}>
                      <span className="ca-ico" aria-hidden="true">📖</span>
                      <span className="ca-lbl">{t('leisure.read')}</span>
                      <b>{state.nextReadInGameHours > 0 ? shortDuration(state.nextReadInGameHours) : t('venue.free')}</b>
                    </button>
                  </li>
                  <li>
                    <button className="chip-act" disabled={busy || state.nextMusicInGameHours > 0} onClick={() => void run(listenMusic, () => t('music.homeDone')).then((r) => { if (r) { playAct('music'); void playTogoRadio(); } })}>
                      <span className="ca-ico" aria-hidden="true">🎵</span>
                      <span className="ca-lbl">{t('music.home')}</span>
                      <b>{state.nextMusicInGameHours > 0 ? shortDuration(state.nextMusicInGameHours) : t('venue.free')}</b>
                    </button>
                  </li>
                  <li>
                    {/* « Couper » arrête l'activité en cours (télé, musique, lecture…) ; sans activité, c'est la pause de la musique */}
                    <button
                      className="chip-act"
                      type="button"
                      onClick={() => {
                        if (homeAct) {
                          if (homeAct === 'music') stopMusic();
                          window.dispatchEvent(new Event(HOME_STOP_EVENT));
                        } else if (isPlaying()) togglePause();
                        else void playTogoRadio();
                      }}
                      aria-label={t('music.pause')}
                      title={t('music.pause')}
                    >
                      <span className="ca-ico" aria-hidden="true">{homeAct ? '⏹' : isPlaying() && !isPaused() ? '⏸' : '▶️'}</span>
                      <span className="ca-lbl">{homeAct || (isPlaying() && !isPaused()) ? t('music.pause') : t('music.play')}</span>
                    </button>
                  </li>
                  <li>
                    <button className="chip-act" type="button" onClick={() => void playTogoRadio()} aria-label={t('music.changeTrack')} title={t('music.changeTrack')}>
                      <span className="ca-ico" aria-hidden="true">⏭</span>
                      <span className="ca-lbl">{t('music.changeTrack')}</span>
                    </button>
                  </li>
                  <li>
                    <label className="chip-act" title={t('music.volume')}>
                      🔈
                      <input type="range" min={0} max={100} defaultValue={Math.round(musicVolume() * 100)} onChange={(e) => setMusicVolume(Number(e.target.value) / 100)} aria-label={t('music.volume')} style={{ width: '5.5rem' }} />
                    </label>
                  </li>
                  <li>
                    <button className="chip-act" onClick={() => (setDecorOpen(true), setPanelMin(true))}>
                      <span className="ca-ico" aria-hidden="true">🛋️</span>
                      <span className="ca-lbl">{t('decor.chip')}</span>
                    </button>
                  </li>
                  <li>
                    <button className="chip-act" onClick={() => openApp('kitchen')}>
                      <span className="ca-ico" aria-hidden="true">🍳</span>
                      <span className="ca-lbl">{t('kitchen.homeChip')}</span>
                    </button>
                  </li>
                  <li>
                    <button className="chip-act" disabled={busy || !catalog} onClick={() => void run(wash, () => t('rest.washDone')).then((r) => r && playAct('wash'))}>
                      <span className="ca-ico" aria-hidden="true">🚿</span>
                      <span className="ca-lbl">{t('rest.washTitle')}</span>
                      <b>{t('rest.washBilled')}</b>
                    </button>
                  </li>
                  <li>
                    <button className="chip-act" disabled={busy || balance < BigInt(state.rent.monthly)} onClick={() => void run(payRent, (res) => t('rent.paid', { amount: fcfa(res.result.paid ?? state.rent.monthly) }))}>
                      <span className="ca-ico" aria-hidden="true">🔑</span>
                      <span className="ca-lbl">{t('home.payRent')}</span>
                      <b>{fcfa(state.rent.monthly)}</b>
                    </button>
                  </li>
                </>
              )}
              {/* Hôpital : la consultation passe par le dossier médical (examen, analyses, ordonnance, traitement) */}
              {view !== 'home' && !(view === 'street' && near && near !== state.location) && state.amu.hospitals.includes(state.location) && (
                <li>
                  <button className="chip-act" onClick={() => openApp('health')}>
                    <span className="ca-ico" aria-hidden="true">🩺</span>
                    <span className="ca-lbl">{t('health2.consultChip')}</span>
                    <b>{state.illness?.id ? t(state.illness.diagnosed ? 'health2.chipTreat' : 'health2.chipIll') : t('health2.chipFile')}</b>
                  </button>
                </li>
              )}
              {view !== 'home' &&
                (!(view === 'street' && near && near !== state.location)) &&
                (activities.length > 4 ? activities.slice(0, 3) : activities).map((a) => (
                  <li key={a.id}>
                    <button
                      className="chip-act"
                      disabled={busy || closedHere || state.doneToday?.includes(a.id) || balance < BigInt(costOf(a.price))}
                      onClick={() => void run(() => doActivity(a.id), () => t('venue.done', { activity: `${a.emoji} ${localName(a, i18n.language)}`, price: a.price > 0 ? (amuHere ? `${fcfa(costOf(a.price))} · AMU` : fcfa(a.price)) : t('venue.free') })).then((r) => { if (!r) return; playWorship(a.id); playDance(a.id); if (a.health > 0) playConsult(['examine']); })}
                    >
                      <span className="ca-ico" aria-hidden="true">{a.emoji}</span>
                      <span className="ca-lbl">{localName(a, i18n.language)}</span>
                      <b>{a.price > 0 ? (amuHere ? `${fcfa(costOf(a.price))} · AMU` : fcfa(a.price)) : t('venue.free')}</b>
                    </button>
                  </li>
                ))}
              {view !== 'home' && activities.length > 4 && !(view === 'street' && near && near !== state.location) && (
                <li>
                  <button className="chip-act app" onClick={() => setCatalogOpen(true)}>
                    <span className="ca-ico" aria-hidden="true">🛍️</span>
                    <span className="ca-lbl">{t('venue.seeAll', { count: activities.length })}</span>
                  </button>
                </li>
              )}
              {/* Lieux à démarches (université, banques, agences Yas et Moov) : un bouton par démarche, qui ouvre la bonne appli sur le bon onglet ;
                  les autres lieux reliés à une appli gardent un seul bouton */}
              {view !== 'home' && here?.app && !(view === 'street' && near && near !== state.location) &&
                (VENUE_SHORTCUTS[here.app] ?? [{ app: here.app as AppId, ico: '📱', label: `phone.apps.${here.app}` }]).map((sc) => (
                  <li key={`${sc.app}-${sc.tab ?? ''}`}>
                    <button className="chip-act app" onClick={() => (sc.tab && focusSection(`${sc.app}-${sc.tab}`), openApp(sc.app))}>
                      <span className="ca-ico" aria-hidden="true">{sc.ico}</span>
                      <span className="ca-lbl">{t(sc.label)}</span>
                    </button>
                  </li>
                ))}
              {view !== 'home' && gearVenues.includes(state.location) && !(view === 'street' && near && near !== state.location) && (
                <li>
                  <button className="chip-act app" onClick={() => (focusSection('kitchen-shop'), openApp('kitchen'))}>
                    <span className="ca-ico" aria-hidden="true">🍳</span>
                    <span className="ca-lbl">{t('venue.kitchenGear')}</span>
                  </button>
                </li>
              )}
              {/* Téléphone : « Plus » déplie toutes les actions du lieu (le CSS ne montre ce bouton que sur petit écran) */}
              <li className="chips-more">
                <button className="chip-act" type="button" onClick={() => setChipsAll((v) => !v)}>
                  {chipsAll ? t('street.collapse') : t('venue.more')}
                </button>
              </li>
            </ul>
          </div>
        )}
        {view === 'home' && decorOpen && (
          <HomeDecor
            view={homeFurn}
            reload={loadHomeFurn}
            room={interior}
            selected={decorSel}
            setSelected={setDecorSel}
            pending={decorPending}
            setPending={setDecorPending}
            onClose={() => { setDecorOpen(false); setDecorSel(null); setDecorPending(null); setPanelMin(false); }}
          />
        )}
        {amb && (
          <div className="amb-overlay" role="status" aria-live="polite">
            <div className="trip-bar amb-bar">
              <span className="trip-mode" aria-hidden="true">🚑</span>
              <div className="trip-main">
                <div className="trip-head">
                  <strong>{t(amb === 'coming' ? 'samu.ambComing' : 'samu.ambLoading')}</strong>
                  {amb === 'coming' && ambTrip && <small>{t('trip.left', { s: ambTrip.secondsLeft })}</small>}
                </div>
                {amb === 'coming' && ambTrip && <div className="trip-track"><div className="trip-fill" style={{ width: `${ambTrip.ratio * 100}%` }} /></div>}
              </div>
            </div>
          </div>
        )}
        {state.hospital && !amb && !ambDue && <HospitalOverlay quality={quality} look={look} clock={clock} hospital={state.hospital} venueName={localName(venueById.get(state.hospital.venueId) ?? { nameFr: state.hospital.venueId, nameEn: state.hospital.venueId }, i18n.language)} onDone={() => void getCharacter().then(apply).catch(() => undefined)} />}
        {state.sleep && <SleepOverlay sleep={state.sleep} busy={busy} onWake={() => void run(wake, (r) => t('sleep.woke', { n: r.result.energyGain }))} onDone={() => void getCharacter().then(apply).catch(() => undefined)} />}
        {travelling && trip && (
          <div className="trip-bar" role="status" aria-live="polite">
            <span className="trip-mode" aria-hidden="true">{({ WALK: '🚶', ZEM: '🏍️', WORO: '🚕', BUS: '🚌', CAR: '🚗' } as Record<string, string>)[trip.mode] ?? '🚶'}</span>
            <div className="trip-main">
              <div className="trip-head">
                <strong>{t('trip.to', { place: venueById.get(trip.to) ? localName(venueById.get(trip.to)!, i18n.language) : '' })}</strong>
                <small>{t(`transport.${trip.mode}`, { defaultValue: trip.mode })} · {Math.round(trip.ratio * 100)} % · {t('trip.left', { s: trip.secondsLeft })}</small>
              </div>
              <div className="trip-track"><div className="trip-fill" style={{ width: `${trip.ratio * 100}%` }} /><span className="trip-dot" style={{ left: `${trip.ratio * 100}%` }} /></div>
            </div>
            {onBus && (
              <button
                type="button"
                className="btn small trip-view"
                aria-pressed={busAbove}
                onClick={() => {
                  setBusAbove((v) => !v);
                  city.current?.setHidden(busAbove);
                }}
              >
                {busAbove ? `${rideVehicle === 'taxi' ? '🚕' : '🚌'} ${t('trip.viewInside')}` : `🛰️ ${t('trip.viewAbove')}`}
              </button>
            )}
          </div>
        )}
        {inCity && !(onBus && !busAbove) && (
          <button type="button" className="shot-btn" aria-label={t('capture.take')} title={t('capture.take')} onClick={() => void takeScreenshot()}>📷</button>
        )}
        {view === 'map' && !travelling && <p className="map-hint">{t('map.hint')}</p>}
        {view === 'map' && !travelling && (
          <button type="button" className="btn primary walk-btn" onClick={() => setView('street')}>
            🚶 {t('map.walk')}
          </button>
        )}
        {view === 'map' && !travelling && (
          <MapBar names={names} onNames={setNames} boards={boardsOn} onBoards={setBoardsOn} onRecenter={() => city.current?.recenter()} onRotate={(r) => city.current?.rotateMap(r)} onPlaces={() => openApp('places')} />
        )}
        {view === 'street' && !travelling && <Joystick minBottom={joyMin} onMove={(x, y) => city.current?.setMove(x, y)} />}
        {(view === 'home' || view === 'inside') && !state.sleep && !(view === 'home' && decorOpen) && <Joystick minBottom={joyMin} onMove={(x, y) => interior.current?.setMove(x, y)} />}

        <nav className="bottom-nav" aria-label={t('nav.label')}>
          <button className={view === 'home' && !sideChat && !phoneOpen ? 'nav-btn active' : 'nav-btn'} onClick={() => (setSideChat(false), state.location === HOME ? setView('home') : setPicked(HOME))} disabled={travelling}>
            <span aria-hidden="true">🏠</span>
            {t('nav.home')}
          </button>
          <button className={view === 'map' && !sideChat && !phoneOpen ? 'nav-btn active' : 'nav-btn'} onClick={() => (setSideChat(false), setView(view === 'map' ? viewFor(state.location) : 'map'))} disabled={travelling}>
            <span aria-hidden="true">🗺️</span>
            {t('nav.map')}
          </button>
          {/* Chat (sur téléphone : ici dans la barre ; sur ordinateur : bouton flottant au bord droit) */}
          <button className={sideChat ? 'nav-btn nav-chat active' : 'nav-btn nav-chat'} onClick={() => (setPhoneOpen(false), setSideChat((v) => !v))}>
            <span aria-hidden="true">💬</span>
            {t('chat.side')}
            {(() => {
              const n = lvAlerts.unread + Object.values(lvAlerts.dmUnread).reduce((a, b) => a + b, 0);
              return n > 0 && !sideChat ? <span className="nav-count">{n > 9 ? '9+' : n}</span> : null;
            })()}
          </button>
          <button className={phoneOpen ? 'nav-btn active' : 'nav-btn'} onClick={() => (setSideChat(false), openApp(null))}>
            <span aria-hidden="true">📱</span>
            {t('nav.phone')}
            {/* Pastille : il y a quelque chose à voir dans le téléphone (même fermé) */}
            {phoneAlerts > 0 && <span className="badge-dot" aria-label={t('nav.phoneAlerts', { count: phoneAlerts })} />}
          </button>
        </nav>

        {picked && catalog && (
          <VenueSheet
            venue={pickedVenue}
            brand={pickedVenue ? places.find((p) => p.x === pickedVenue.x && p.z === pickedVenue.z && pickedVenue.id.startsWith('brand_')) ?? null : null}
            from={posOf(state.location)}
            to={posOf(picked)}
            here={picked === state.location}
            workFor={state.job && picked === workGoing ? localName(state.job, i18n.language) : null}
            onGo={(mode) => void go(picked, mode)}
            onEnter={() => {
              setPicked(null);
              setView(viewFor(state.location));
            }}
            onClose={() => setPicked(null)}
          />
        )}
        {board && (
          <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && setBoard(null)}>
            <div className="venue-card" role="dialog" aria-modal="true" aria-label={board.title}>
              <div className="sheet-grip" aria-hidden="true" />
              <header className="venue-head">
                <span className="venue-emoji" aria-hidden="true">📢</span>
                <div>
                  <h2>{board.partner}</h2>
                  <small>{t(`billboard.kinds.${board.partnerKind}`)} · {t('billboard.until', { date: new Date(board.endsAt).toLocaleDateString(i18n.language) })}</small>
                </div>
                <button className="btn ghost small close" onClick={() => setBoard(null)} aria-label={t('app.close')}>✕</button>
              </header>
              {board.hasImage ? (
                <img className="ad-image-preview" src={`/api/boards/${board.id}/image`} alt={board.title} />
              ) : (
                <AdArt title={board.title} sub={board.subtitle ?? ''} bg={board.bg} fg={board.fg} w={2} h={1} />
              )}
              {board.url ? (
                <button
                  className="btn primary big go"
                  onClick={() => {
                    void billboardClick(board.id).catch(() => undefined);
                    window.open(board.url!, '_blank', 'noopener,noreferrer');
                  }}
                >
                  🔗 {t('billboard.visit', { host: new URL(board.url).host })}
                </button>
              ) : (
                <p className="muted small-line">{t('billboard.noSite')}</p>
              )}
              <div className="panel">
                <strong>📣 {t('billboard.yourAd')}</strong>
                <small className="muted">{t('billboard.yourAdText')}</small>
                <BookBoard panel={board.slot >= 0 || boardPanel === null ? null : boardPanel} />
              </div>
            </div>
          </div>
        )}
        {freeSlot !== null && (
          <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && setFreeSlot(null)}>
            <div className="venue-card" role="dialog" aria-modal="true" aria-label={t('billboard.yourAd')}>
              <div className="sheet-grip" aria-hidden="true" />
              <header className="venue-head">
                <span className="venue-emoji" aria-hidden="true">📢</span>
                <div>
                  <h2>{t('billboard.yourAd')}</h2>
                </div>
                <button className="btn ghost small close" onClick={() => setFreeSlot(null)} aria-label={t('app.close')}>✕</button>
              </header>
              <div className="panel">
                <small className="muted">{t('billboard.yourAdText')}</small>
                <BookBoard panel={freeSlot} />
              </div>
            </div>
          </div>
        )}
        {vip && <VipSpaceSheet spot={vip} onClose={() => setVip(null)} onRequested={(id) => setFreeSpots((l) => l.map((f) => (f.id === id ? { ...f, requested: true } : f)))} />}
        {place && (
          <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && setPlace(null)}>
            <div className="venue-card brand-card" role="dialog" aria-modal="true" aria-label={place.label}>
              <header className="brand-head" style={{ background: `linear-gradient(135deg, ${place.color}, ${place.color}bb)` }}>
                <span className="brand-logo" aria-hidden={!place.logo}>
                  {place.logo ? <img src={place.logo} alt={place.name} /> : <b>{place.label.slice(0, 1).toUpperCase()}</b>}
                </span>
                <div>
                  <span className="brand-tier">{place.tier === 'GOLD' ? '👑' : place.tier === 'SILVER' ? '⭐' : '🥉'} {t(`vip.name.${place.tier}`, { defaultValue: t(`partners.tier.${place.tier}`) })}</span>
                  <h2>{place.label}</h2>
                  <small>{place.name} · {t(`billboard.kinds.${place.kind}`)}</small>
                </div>
                <button className="btn ghost small close" onClick={() => setPlace(null)} aria-label={t('app.close')}>✕</button>
              </header>
              <ul className="brand-facts">
                <li><span aria-hidden="true">🏷️</span><div><small>{t('admin.f.kind')}</small><strong>{t(`billboard.kinds.${place.kind}`)}</strong></div></li>
                <li><span aria-hidden="true">🏢</span><div><small>{t('admin.f.placeModel')}</small><strong>{t(`admin.models.${place.model}.name`, { defaultValue: place.model })}</strong></div></li>
                <li><span aria-hidden="true">{place.tier === 'GOLD' ? '👑' : place.tier === 'SILVER' ? '⭐' : '🥉'}</span><div><small>{t('admin.f.tier')}</small><strong>{t(`partners.tier.${place.tier}`)}</strong></div></li>
              </ul>
              <p className="brand-text">{t('partners.placeText')}</p>
              {place.url ? (
                <button className="btn primary big go brand-go" style={{ background: place.color }} onClick={() => window.open(place.url!, '_blank', 'noopener,noreferrer')}>
                  🔗 {t('billboard.visit', { host: new URL(place.url).host })}
                </button>
              ) : (
                <p className="brand-nosite">{t('billboard.noSite')}</p>
              )}
            </div>
          </div>
        )}
        {zemSheet && (
          <ZemBikeSheet
            state={state}
            busy={busy}
            onClose={() => setZemSheet(false)}
            onStart={(bike) => void run(() => startShift('job', bike), (r) => t('work.shiftStarted', { n: r.result.missions })).then((r) => r && setZemSheet(false))}
            onContract={(action) => void run(() => zemContract(action), () => (action === 'sign' && state.zemBike ? t('work.zemBike.contractOn', { amount: fcfa(state.zemBike.ownerFee) }) : null))}
          />
        )}
        {catalogOpen && (
          <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && setCatalogOpen(false)}>
            <div className="venue-card catalog" role="dialog" aria-modal="true" aria-label={placeName}>
              <div className="sheet-grip" aria-hidden="true" />
              <header className="venue-head">
                <span className="venue-emoji" aria-hidden="true">🛍️</span>
                <div>
                  <h2>{placeName}</h2>
                  <small>{t('venue.articles', { count: activities.length })} · {fcfa(state.wallet.balance)}</small>
                </div>
                <button className="btn ghost small close" onClick={() => setCatalogOpen(false)} aria-label={t('app.close')}>✕</button>
              </header>
              <input className="catalog-search" type="search" placeholder={t('venue.search')} value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} />
              <ul className="catalog-list">
                {activities
                  .filter((a) => matches(catalogQuery, localName(a, i18n.language)))
                  .map((a) => (
                    <li key={a.id}>
                      <button
                        className="catalog-item"
                        disabled={busy || closedHere || state.doneToday?.includes(a.id) || balance < BigInt(costOf(a.price))}
                        onClick={() => void run(() => doActivity(a.id), () => t('venue.done', { activity: `${a.emoji} ${localName(a, i18n.language)}`, price: a.price > 0 ? (amuHere ? `${fcfa(costOf(a.price))} · AMU` : fcfa(a.price)) : t('venue.free') })).then((r) => { if (!r) return; playWorship(a.id); playDance(a.id); if (a.health > 0) playConsult(['examine']); })}
                      >
                        <span className="catalog-emoji" aria-hidden="true">{a.emoji}</span>
                        <span className="catalog-name">{localName(a, i18n.language)}</span>
                        <b>{a.price > 0 ? (amuHere ? `${fcfa(costOf(a.price))} · AMU` : fcfa(a.price)) : t('venue.free')}</b>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}
        {lookOpen && <LookEditor initial={saved} onClose={() => setLookOpen(false)} />}
        {seaCell && seaData && zoneData(seaCell.zone)?.price != null && (
          <BookPlot zone={seaCell.zone} grid={zoneData(seaCell.zone)!.grid} price={zoneData(seaCell.zone)!.price!} periodDays={seaData.periodDays ?? 7} periods={seaData.periods?.length ? seaData.periods : [1]} plots={zoneData(seaCell.zone)!.plots} x={seaCell.x} y={seaCell.y} onClose={() => setSeaCell(null)} />
        )}
        {plot && (
          <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && setPlot(null)}>
            <div className="venue-card" role="dialog" aria-modal="true" aria-label={plot.title}>
              <div className="sheet-grip" aria-hidden="true" />
              <header className="venue-head">
                <span className="venue-emoji" aria-hidden="true">🌊</span>
                <div>
                  <h2>{plot.partner}</h2>
                  <small>{t('plots.size', { w: plot.w, h: plot.h })}</small>
                </div>
                <button className="btn ghost small close" onClick={() => setPlot(null)} aria-label={t('app.close')}>✕</button>
              </header>
              {plot.hasImage ? (
                <img className="ad-image-preview" src={`/api/boards/${plot.id}/image`} alt={plot.title} />
              ) : (
                <AdArt title={plot.title ?? ''} sub={plot.subtitle ?? ''} bg={plot.bg ?? '#0a7d4f'} fg={plot.fg ?? '#ffffff'} w={plot.w} h={plot.h} />
              )}
              {plot.url ? (
                <button
                  className="btn primary big go"
                  onClick={() => {
                    void billboardClick(plot.id).catch(() => undefined);
                    window.open(plot.url!, '_blank', 'noopener,noreferrer');
                  }}
                >
                  🔗 {t('billboard.visit', { host: new URL(plot.url).host })}
                </button>
              ) : (
                <p className="muted small-line">{t('billboard.noSite')}</p>
              )}
              <small className="muted center-line">{t('plots.floating', { count: plot.w * plot.h, date: plot.endsAt ? new Date(plot.endsAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) : '—' })}</small>
            </div>
          </div>
        )}
        {lesson && <ClassRoom course={lesson} look={look} onClose={() => setLesson(null)} />}
        {talk && <ConferenceRoom info={talk.info} talk={talk.talk} look={look} onClose={() => setTalk(null)} />}
        <Tour ready={!lookOpen && !phoneOpen && !lesson && !talk} />
        {phoneOpen && <Phone app={app} setApp={setApp} onClose={() => setPhoneOpen(false)} />}
        {/* Messages à gauche, juste sous les blocs de gauche (position suivie en direct), au-dessus de tout */}
        <div className="toasts" aria-live="polite" style={{ top: toastTop }}>
          {toasts.map((x) => (
            <div key={x.id} className={`toast ${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'} onClick={() => { setToasts((l) => l.filter((y) => y.id !== x.id)); if (x.app) openApp(x.app); }}>
              {x.msg}
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** Même affiche illustrée que sur le panneau ou la parcelle de la ville, pour une annonce sans image. */
function AdArt({ title, sub, bg, fg, w, h }: { title: string; sub: string; bg: string; fg: string; w: number; h: number }) {
  const src = useMemo(() => drawAdArt(title, sub, bg, fg, w, h).toDataURL('image/png'), [title, sub, bg, fg, w, h]);
  return <img className="ad-image-preview" src={src} alt={title} />;
}

/** Nuit de sommeil : écran sombre avec la progression, réveil automatique à l'heure prévue ou avancé à la demande. */
/** Prise en charge du SAMU à l'hôpital : écran d'attente, le temps des soins ; à l'échéance l'état est rechargé (en forme, facture). */
function HospitalOverlay({ hospital: h, venueName, quality, look, clock, onDone }: { hospital: { until: string; startedAt: string | null }; venueName: string; quality: Quality; look: PersonLook; clock: GameClock; onDone: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [standing, setStanding] = useState(false);
  const until = Date.parse(h.until);
  const start = h.startedAt ? Date.parse(h.startedAt) : until - 1;
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, until - now);
  // Guéri : le patient se lève dans la salle (quelques secondes), puis l'état est rechargé
  useEffect(() => {
    if (left > 0) return;
    setStanding(true);
    const id = window.setTimeout(onDone, 3600);
    return () => window.clearTimeout(id);
  }, [left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const ratio = Math.min(1, Math.max(0, (now - start) / Math.max(1, until - start)));
  const stage = ratio < 0.25 ? 'transfer' : ratio < 0.6 ? 'care' : 'recover';
  return (
    <div className="hospital-overlay ward" role="dialog" aria-label={t('samu.overlayTitle')}>
      <InteriorScene key="ward" quality={quality} kind="clinic" look={look} open clock={clock} ward={!standing} />
      <div className="hospital-card">
        <h2>🏥 {t('samu.wardTitle')} · {venueName}</h2>
        <p>{standing ? t('samu.wardUp') : t('samu.wardRounds')}</p>
        <ol className="hospital-steps inline">
          {(['transfer', 'care', 'recover'] as const).map((k) => (
            <li key={k} className={stage === k ? 'active' : ratio > (k === 'transfer' ? 0.25 : 0.6) ? 'done' : ''}>{t(`samu.stage.${k}`)}</li>
          ))}
        </ol>
        <div className="trip-track"><div className="trip-fill" style={{ width: `${ratio * 100}%` }} /></div>
        <small>{t('sleep.left', { m: Math.floor(left / 60000), s: String(Math.floor((left % 60000) / 1000)).padStart(2, '0') })}</small>
      </div>
    </div>
  );
}

function SleepOverlay({ sleep: z, busy, onWake, onDone }: { sleep: { startedAt: string | null; until: string }; busy: boolean; onWake: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const until = Date.parse(z.until);
  const start = z.startedAt ? Date.parse(z.startedAt) : until - 1;
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, until - now);
  useEffect(() => {
    if (left > 0) return;
    // Fin du sommeil : on relit le personnage, et on recommence toutes les 3 s tant que le serveur ne l'a pas réveillé (horloge de
    // l'appareil en avance sur celle du serveur : l'énergie restait à 0 % jusqu'à la prochaine actualisation)
    onDone();
    const id = window.setInterval(onDone, 3000);
    return () => window.clearInterval(id);
  }, [left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const ratio = Math.min(1, Math.max(0, (now - start) / Math.max(1, until - start)));
  const min = Math.floor(left / 60000);
  const sec = Math.floor((left % 60000) / 1000);
  return (
    <div className="sleep-overlay" role="dialog" aria-label={t('sleep.title')}>
      <div className="sleep-sky" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 70}%`, animationDelay: `${(i % 6) * 0.5}s` }} />)}</div>
      <div className="sleep-card">
        <div className="sleep-moon" aria-hidden="true">🌙</div>
        <h2>{t('sleep.title')} <span className="zzz" aria-hidden="true">z z z</span></h2>
        <p>{t('sleep.text')}</p>
        <div className="trip-track"><div className="trip-fill sleep-fill" style={{ width: `${ratio * 100}%` }} /></div>
        <small>{t('sleep.left', { m: min, s: String(sec).padStart(2, '0') })}</small>
        <button className="btn big" disabled={busy} onClick={onWake}>☀️ {t('sleep.wakeNow')}</button>
        <small className="muted">{t('sleep.wakeHint')}</small>
      </div>
    </div>
  );
}

/** Monté avec les scènes, dans la même attente de chargement : signale que la première scène est affichée. */
function SceneReady({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}
