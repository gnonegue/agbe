import { useEffect, useRef } from 'react';
import type { TFunction } from 'i18next';
import { getConference, getCourses, getIndustry, getIndustryMarket, getInvest, getPartnerOffers, getTrade, type IndustryListing, type IndustryView, type ConferenceInfo, type CourseInfo, type PartnerOffer, type StockInfo, type TradeGood } from '../api/endpoints';
import type { State } from '../api/types';
import type { GameClock } from '../game/clock';
import { fcfa, localName } from '../lib/format';
import { setTradeFocus } from '../lib/tradeFocus';
import type { AppId } from '../phone/ctx';

type Kind = 'ok' | 'error' | 'info';

interface Args {
  state: State;
  clock: GameClock;
  toast: (msg: string, kind?: Kind, app?: AppId) => void;
  t: TFunction;
  lang: string;
  /** Clé de stockage des rappels déjà donnés (par compte) : un rechargement de la page ne les fait pas répéter. */
  memoryKey?: string;
  /** Nom traduit d'un lieu (pour dire où a lieu la conférence). */
  venueName: (id: string) => string;
}

const REFRESH_COURSES_MS = 90_000;
const REFRESH_DEALS_MS = 240_000;
/** Écart minimal entre prix de revente et d'achat pour parler de « bonne affaire ». */
const DEAL_MIN_MARGIN = 0.25;
/** Les rappels peu importants (bonne affaire, bourse) attendent un peu après le dernier rappel, pour ne pas parler en continu. */
const QUIET_MS = 45_000;
/**
 * Créneaux d'annonce des bonnes affaires du commerce (minutes du jour de jeu) : une annonce au plus par créneau, donc
 * jusqu'à trois par jour de jeu (un jour de jeu ≈ une heure réelle), jamais deux fois la même marchandise dans la journée.
 */
const DEAL_SLOTS: [number, number][] = [
  [6 * 60, 12 * 60],
  [12 * 60, 18 * 60],
  [18 * 60, 23 * 60],
];
/** Bourse : gain sur le prix d'achat moyen à partir duquel on propose de revendre (les frais d'achat et de vente sont déjà couverts). */
const STOCK_GAIN_MIN = 0.1;
/** Bourse : cours sous sa moyenne des jours précédents d'au moins cette part = bon moment pour acheter. */
const STOCK_DIP_MIN = 0.08;
/** Bourse : action détenue sous son prix d'achat moyen d'au moins cette part = alerte de baisse. */
const STOCK_LOSS_MIN = 0.1;
/** Commerce : marchandise en stock dont le prix de revente du jour s'écarte du prix d'achat moyen d'au moins cette part. */
const TRADE_MOVE_MIN = 0.12;
/** Industrie : offre d'un investisseur à partir de cette valorisation (part du prix du site) = très bonne offre. */
const INVESTOR_GOOD_OFFER = 1.5;
/** Industrie : bénéfice en attente à partir de ce nombre de jours de production (le plafond est à 60) = penser à encaisser. */
const PLANT_PENDING_DAYS = 30;
/** Industrie : site revendu par un joueur à ce prix ou moins (part du prix de l'État) = bonne affaire à saisir. */
const PLANT_CHEAP_LISTING = 0.9;

/**
 * Rappels de la partie (affichés en notification ET lus à voix haute, une seule annonce à la fois) :
 * santé basse, cours à suivre, message important, bonne affaire. Chaque rappel n'est donné qu'une fois par jour de jeu
 * (la santé critique toutes les 6 h de jeu).
 */
export function useReminders({ state, clock, toast, t, lang, venueName, memoryKey }: Args): void {
  // Rappels déjà donnés (clé → jour de jeu) : gardés dans ce navigateur, pour ne pas les répéter après un rechargement
  const said = useRef<Record<string, number>>(
    (() => {
      try {
        return memoryKey ? ((JSON.parse(localStorage.getItem(memoryKey) ?? '{}') as Record<string, number>) ?? {}) : {};
      } catch {
        return {};
      }
    })(),
  );
  const lastSaid = useRef(0);
  const courses = useRef<CourseInfo[]>([]);
  const conference = useRef<ConferenceInfo | null>(null);
  const deals = useRef<{ goods: TradeGood[]; offers: PartnerOffer[] }>({ goods: [], offers: [] });
  const stocks = useRef<StockInfo[]>([]);
  const industry = useRef<{ view: IndustryView | null; listings: IndustryListing[] }>({ view: null, listings: [] });
  const live = useRef(state);
  live.current = state;
  // Fonction recréée à chaque rendu : lue par référence pour ne pas relancer la minuterie
  const names = useRef(venueName);
  names.current = venueName;

  // Données des rappels : rafraîchies à part, sans jamais gêner le jeu en cas d'erreur réseau
  useEffect(() => {
    let off = false;
    const loadCourses = () => {
      void getCourses().then((c) => !off && (courses.current = c), () => undefined);
      void getConference().then((c) => !off && (conference.current = c), () => undefined);
    };
    const loadDeals = () => {
      void getTrade().then((r) => !off && (deals.current.goods = r.goods), () => undefined);
      void getPartnerOffers().then((o) => !off && (deals.current.offers = o), () => undefined);
      void getInvest().then((r) => !off && (stocks.current = r.stocks), () => undefined);
      void getIndustry().then((v) => !off && (industry.current.view = v), () => undefined);
      void getIndustryMarket().then((r) => !off && (industry.current.listings = r.listings), () => undefined);
    };
    loadCourses();
    loadDeals();
    const a = window.setInterval(loadCourses, REFRESH_COURSES_MS);
    const b = window.setInterval(loadDeals, REFRESH_DEALS_MS);
    return () => {
      off = true;
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, []);

  useEffect(() => {
    const once = (key: string, bucket: number): boolean => {
      if (said.current[key] === bucket) return false;
      said.current[key] = bucket;
      if (memoryKey) {
        try {
          // On ne garde que les rappels récents (le jour de jeu change toutes les heures réelles)
          const keep = Object.fromEntries(Object.entries(said.current).filter(([, b]) => b >= bucket - 2)) as Record<string, number>;
          localStorage.setItem(memoryKey, JSON.stringify(keep));
        } catch {
          /* stockage indisponible : mémoire de la session seulement */
        }
      }
      return true;
    };
    const tick = () => {
      const s = live.current;
      if (s.sleep) return;
      const total = clock.totalMinutes();
      const day = Math.floor(total / 1440);
      const m = clock.minuteOfDay();
      // `toast` lit aussi le message à voix haute
      const say = (msg: string, kind: Kind) => {
        lastSaid.current = Date.now();
        toast(msg, kind);
      };

      // 1. Santé
      if (s.needs.health < 30 && once('healthCritical', Math.floor(total / 360))) return say(t('remind.healthCritical'), 'error');
      if (s.needs.health < 50 && once('healthLow', day)) return say(t('remind.healthLow'), 'info');

      // 1 bis. Les alertes du téléphone, aussi hors du téléphone : maladie, appel de la famille, coupures
      if (s.illness && !s.illness.diagnosed && once('illSymptoms', day)) return say(t('remind.illSymptoms', { day: s.illness.sinceDay ?? '' }), 'error');
      if (s.illness?.diagnosed && s.illness.id && once('illDiagnosed', day)) return say(t('remind.illDiagnosed', { name: t(`health2.ill.${s.illness.id}`, { defaultValue: s.illness.id }) }), 'error');
      if (s.medicalBill && once('medicalBill', day)) return say(t('remind.medicalBill', { amount: fcfa(s.medicalBill.amount) }), 'info');
      if ((s.familyPending ?? 0) > 0 && once('family', day)) return say(t('remind.family'), 'info');
      if (s.outages?.power && once('power', day)) return say(t('remind.power'), 'info');
      if (s.outages?.water && once('water', day)) return say(t('remind.water'), 'info');
      // Assurance maladie (AMU) arrivée à échéance : la pastille rouge « AMU » du haut de l'écran la signale ; ici, une fois par
      // jour de jeu, le message dans la cloche et à voix haute (rien sur l'écran)
      if (!s.amu.covered && once('amuExpired', day)) {
        lastSaid.current = Date.now();
        return toast(t('remind.amuExpired', { amount: fcfa(s.amu.monthly) }), 'info', 'health');
      }

      // 2. Cours à suivre : de 1 h avant l'heure du cours jusqu'à la fin du retard toléré pour entrer en classe
      //    (l'heure vient de l'horloge du jeu : la liste des cours n'est relue que toutes les 90 s)
      for (const c of courses.current) {
        if (!c.enrolled || c.completed || c.attendedToday || c.seated) continue;
        const start = c.startHour * 60;
        if (m < start - 60 || m >= start + c.lateMinutes) continue;
        const name = `${c.emoji} ${localName(c, lang)}`;
        const now = m >= start;
        if (now ? once(`courseNow:${c.id}`, day) : once(`course:${c.id}`, day)) {
          return say(t(now ? 'remind.courseNow' : 'remind.course', { course: name, hour: c.startHour, min: c.lateMinutes }), 'info');
        }
      }

      // 2 bis. Conférence du jour : 1 h avant, puis au début (tant qu'on peut encore entrer)
      const cf = conference.current;
      const talk = cf?.upcoming[0];
      if (cf && talk && talk.day === day && !talk.seated && !talk.done) {
        const start = cf.startHour * 60;
        if (m >= start - 60 && m < start + cf.lateMinutes) {
          const now = m >= start;
          if (once(now ? 'conferenceNow' : 'conferenceSoon', day)) {
            const title = `${talk.emoji} ${lang === 'en' ? talk.titleEn : talk.titleFr}`;
            return say(t(now ? 'remind.conferenceNow' : 'remind.conferenceSoon', { title, hour: cf.startHour, min: cf.lateMinutes, fee: fcfa(cf.fee), place: names.current(cf.venueId) }), 'info');
          }
        }
      }

      // 3. Message important (loyer, travail à reprendre)
      // (Le loyer en retard est déjà signalé par la pastille d'alerte du haut : pas de notification en plus.)
      if (!s.rent.owned && !s.rent.overdue && s.rent.paidUntilGameDay - s.gameTime.day <= 3 && once('msgRentSoon', day)) {
        return say(t('remind.message', { from: t('contacts.landlord'), text: t('messages.rentSoon') }), 'info');
      }

      // 3 bis. Bourse : une action détenue a pris de la valeur (à revendre), ou une action est au plus bas (à acheter).
      // Les cours changent une fois par jour de jeu : au plus une alerte par action et par jour.
      for (const st of stocks.current) {
        if (st.held <= 0) continue;
        const avg = Number(st.heldCost) / st.held;
        if (avg > 0 && st.price >= avg * (1 + STOCK_GAIN_MIN) && once(`stockUp:${st.symbol}`, day)) {
          lastSaid.current = Date.now();
          return toast(t('remind.stockUp', { stock: `${st.symbol} · ${localName(st, lang)}`, pct: Math.round((st.price / avg - 1) * 100), price: fcfa(st.price), avg: fcfa(Math.round(avg)) }), 'ok', 'invest');
        }
      }
      // Bourse : une action détenue est passée sous le prix d'achat moyen
      for (const st of stocks.current) {
        if (st.held <= 0) continue;
        const avg = Number(st.heldCost) / st.held;
        if (avg > 0 && st.price <= avg * (1 - STOCK_LOSS_MIN) && once(`stockDown:${st.symbol}`, day)) {
          lastSaid.current = Date.now();
          return toast(t('remind.stockDown', { stock: `${st.symbol} · ${localName(st, lang)}`, pct: Math.round((1 - st.price / avg) * 100), price: fcfa(st.price) }), 'info', 'invest');
        }
      }
      // Commerce : marchandise en stock qui a pris ou perdu de la valeur par rapport au prix d'achat moyen
      if (Date.now() - lastSaid.current > QUIET_MS) {
        for (const g of deals.current.goods) {
          if (!g.held || g.held <= 0) continue;
          const avg = Number(g.heldCost) / g.held;
          if (avg <= 0 || g.sellToday <= 0) continue;
          const name = `${g.emoji} ${localName(g, lang)}`;
          if (g.sellToday >= avg * (1 + TRADE_MOVE_MIN) && once(`tradeUp:${g.id}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.tradeUp', { good: name, price: fcfa(g.sellToday), pct: Math.round((g.sellToday / avg - 1) * 100) }), 'ok', 'trade');
          }
          if (g.sellToday <= avg * (1 - TRADE_MOVE_MIN) && once(`tradeDown:${g.id}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.tradeDown', { good: name, price: fcfa(g.sellToday), pct: Math.round((1 - g.sellToday / avg) * 100) }), 'info', 'trade');
          }
        }
      }
      if (Date.now() - lastSaid.current > QUIET_MS) {
        for (const st of stocks.current) {
          const before = st.series.slice(0, -1);
          if (before.length < 5) continue;
          const mean = before.reduce((a, b) => a + b, 0) / before.length;
          if (mean > 0 && st.price <= mean * (1 - STOCK_DIP_MIN) && once(`stockLow:${st.symbol}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.stockLow', { stock: `${st.symbol} · ${localName(st, lang)}`, pct: Math.round((1 - st.price / mean) * 100), price: fcfa(st.price) }), 'info', 'invest');
          }
        }
      }

      // 3 ter. Industrie : très bonne offre d'un investisseur, bénéfice qui s'accumule (à encaisser avant le plafond), usine à l'arrêt
      // faute de personnel, site revendu sous le prix de l'État. Au plus une alerte par sujet et par jour de jeu.
      const ind = industry.current.view;
      if (ind && Date.now() - lastSaid.current > QUIET_MS) {
        const siteName = (id: string) => {
          const site = ind.sites.find((x) => x.id === id);
          return site ? `${site.emoji} ${localName(site, lang)}` : id;
        };
        for (const p of ind.mine) {
          const site = ind.sites.find((x) => x.id === p.catalogId);
          const net = Number(p.netPerDay);
          if (net > 0 && Number(p.pending) >= net * PLANT_PENDING_DAYS && once(`plantPending:${p.id}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.plantPending', { site: siteName(p.catalogId), amount: fcfa(p.pending) }), 'ok', 'industry');
          }
          // Surproduction : plus de deux jours de ventes normales restés invendus
          const rev = Number(p.revenuePerDay ?? '0');
          if (rev > 0 && Number(p.stockValue ?? '0') >= rev * 2 && once(`plantSurplus:${p.id}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.plantSurplus', { site: siteName(p.catalogId), value: fcfa(p.stockValue ?? '0') }), 'info', 'industry');
          }
          // Équipements : panne ou entretien en retard
          for (const k of ['borehole', 'solar'] as const) {
            const eq = p.equipment;
            if (!eq || !eq[k]) continue;
            const broken = k === 'borehole' ? eq.boreholeBroken : eq.solarBroken;
            const eff = k === 'borehole' ? eq.boreholeEffBp : eq.solarEffBp;
            if ((broken || eff < 10_000) && once(`plantEquip:${p.id}:${k}`, day)) {
              lastSaid.current = Date.now();
              return toast(t(broken ? 'remind.plantEquipBroken' : 'remind.plantEquipService', { site: siteName(p.catalogId), eq: t(`industry.${k}`) }), 'info', 'industry');
            }
          }
          if (p.staff === 0 && once(`plantIdle:${p.id}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.plantIdle', { site: siteName(p.catalogId) }), 'info', 'industry');
          }
          if (!site || p.investor || p.ask) continue;
          const price = Number(site.price);
          const best = [...p.offers].sort((a, b) => Number(b.valuation) - Number(a.valuation))[0];
          if (best && price > 0 && Number(best.valuation) >= price * INVESTOR_GOOD_OFFER && once(`plantOffer:${p.id}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.plantOffer', { investor: `${best.emoji} ${localName(best, lang)}`, site: siteName(p.catalogId), value: fcfa(best.valuation), pct: Math.round((Number(best.valuation) / price - 1) * 100) }), 'ok', 'industry');
          }
        }
        for (const l of industry.current.listings) {
          const site = ind.sites.find((x) => x.id === l.catalogId);
          if (!site || ind.mine.some((p) => p.id === l.id)) continue;
          const price = Number(site.price);
          if (price > 0 && Number(l.ask) <= price * PLANT_CHEAP_LISTING && once(`plantCheap:${l.id}`, day)) {
            lastSaid.current = Date.now();
            return toast(t('remind.plantCheap', { site: siteName(l.catalogId), ask: fcfa(l.ask), pct: Math.round((1 - Number(l.ask) / price) * 100) }), 'info', 'industry');
          }
        }
      }

      // 4. Bonne affaire du commerce : une annonce par créneau (matin, après-midi, soir), jamais juste après un autre rappel,
      // et pas deux fois la même marchandise le même jour
      const slot = DEAL_SLOTS.findIndex(([a, b]) => m >= a && m < b);
      if (slot >= 0 && deals.current.goods.length > 0 && Date.now() - lastSaid.current > QUIET_MS && once(`deal${slot}`, day)) {
        const best = deals.current.goods
          .filter((g) => g.buyToday > 0 && said.current[`dealGood:${g.id}`] !== day)
          .map((g) => ({ g, margin: (g.sellToday - g.buyToday) / g.buyToday }))
          .sort((a, b) => b.margin - a.margin)[0];
        if (best && best.margin >= DEAL_MIN_MARGIN) {
          // Un clic sur la notification ouvre le Commerce directement sur cet article
          setTradeFocus(best.g.id);
          said.current[`dealGood:${best.g.id}`] = day;
          lastSaid.current = Date.now();
          return toast(t('remind.deal', { good: `${best.g.emoji} ${localName(best.g, lang)}`, buy: fcfa(best.g.buyToday), sell: fcfa(best.g.sellToday), pct: Math.round(best.margin * 100) }), 'info', 'trade');
        }
        const offer = slot === 0 ? deals.current.offers[0] : undefined;
        if (offer) return say(t('remind.offer', { title: offer.title, partner: offer.partner }), 'info');
      }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [clock, toast, t, lang]);
}
