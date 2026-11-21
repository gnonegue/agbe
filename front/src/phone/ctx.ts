import { createContext, useContext } from 'react';
import type { Catalog, Me, State } from '../api/types';
import type { ConferenceInfo, ConferenceTalk, CourseInfo } from '../api/endpoints';
import type { JournalEntry, Quality } from '../lib/prefs';
import type { GameClock } from '../game/clock';

export interface GameCtx {
  me: Me;
  state: State;
  catalog: Catalog | null;
  clock: GameClock;
  quality: Quality;
  setQuality: (q: Quality) => void;
  /** Joue la scène de consultation à l'hôpital (examen, résultats, ordonnance) : ferme le téléphone et entre dans la salle. */
  playConsult: (phases: ('examine' | 'results' | 'prescription')[], onDone?: () => void) => void;
  /** Applique un nouvel état renvoyé par l'API. */
  apply: (s: State) => void;
  /**
   * Exécute une action réseau : gère l'occupation, l'erreur traduite et le message de succès.
   * Si l'API signale un rejeu (`result.replay`), l'état est rafraîchi mais aucun « payé X » n'est affiché.
   */
  run: <T>(fn: () => Promise<T>, success?: (r: T) => string | null) => Promise<T | null>;
  busy: boolean;
  /** `app` : application du téléphone où régler le problème (la notification propose de l'ouvrir). */
  toast: (msg: string, kind?: 'ok' | 'error' | 'info', app?: AppId, onScreen?: boolean) => void;
  logout: (msg?: string) => void;
  openApp: (id: AppId | null) => void;
  closePhone: () => void;
  /** Ouvre la fiche d'un lieu sur la carte (pour s'y rendre). */
  goTo: (venueId: string) => void;
  /** Ouvre la salle de classe pour la séance du jour. */
  openClass: (c: CourseInfo) => void;
  /** Entre dans la salle pour la conférence du jour. */
  openConference: (info: ConferenceInfo, talk: ConferenceTalk) => void;
  /** Ferme le téléphone et affiche la carte de la ville. */
  showMap: () => void;
  /** Redessine les terrains à vendre sur la carte après un achat, une vente ou une construction. */
  reloadLand: () => void;
  /** Ferme le téléphone et centre la carte sur une zone de terrain. */
  showLand: (zoneId: string) => void;
  /** Ouvre l'éditeur d'apparence. */
  openLook: () => void;
  /** Récit « Ma vie », le plus récent en premier. */
  journal: JournalEntry[];
  /** Dernières notifications affichées (les plus récentes d'abord), reprises sur l'écran d'accueil du téléphone. */
  notifications: { id: number; msg: string; kind: 'ok' | 'error' | 'info'; at: number; app?: AppId }[];
  clearNotifications: () => void;
  dismissNotification: (id: number) => void;
}

export type AppId = 'chat' | 'tontine' | 'market' | 'family' | 'intercity' | 'hotel' | 'journal' | 'company' | 'study' | 'eat' | 'kitchen' | 'clothes' | 'work' | 'rest' | 'rent' | 'wallet' | 'shop' | 'payroll' | 'trade' | 'estate' | 'invest' | 'industry' | 'bank' | 'fx' | 'notes' | 'messages' | 'contacts' | 'guide' | 'music' | 'ride' | 'garage' | 'games' | 'places' | 'agenda' | 'news' | 'health' | 'samu' | 'weather' | 'calc' | 'ads' | 'dash' | 'settings' | 'bugs' | 'tenders';

export const Ctx = createContext<GameCtx | null>(null);

export function useGame(): GameCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('GameCtx manquant');
  return c;
}
