// Connexion temps réel du jeu : présence des autres joueurs et chat (flux SSE /live/stream).
import { useSyncExternalStore } from 'react';
import { ApiError, api, idempotencyKey, type StreamEvent } from '../api/client';

export interface LivePlayer {
  id: string;
  name: string;
  look: unknown;
  x: number;
  z: number;
  yaw: number;
  /** Véhicule pendant un trajet (null à pied). */
  ride?: Ride | null;
  place: string;
}
/** Véhicule d'un joueur en trajet (MOTO : sa propre moto, sans conducteur devant lui). */
export type Ride = 'ZEM' | 'MOTO' | 'WORO' | 'BUS' | 'CAR';
export interface ChatMsg {
  id: string;
  room: string;
  /** `username` : pseudo du compte (@pseudo), donné dans les salons ville et lieu. */
  from: { id: string; name: string; username?: string | null };
  text: string;
  at: string;
  /** Message auquel celui-ci répond (nom et début du texte), ou null. */
  replyTo?: { id: string; name: string; text: string } | null;
  /** Montant (FCFA) d'un envoi d'argent tracé dans la conversation privée, posé par le serveur ; sinon null (le texte est alors vide). */
  money?: string | null;
}
/** Groupe de discussion : nom, propriétaire et membres. */
export interface GroupInfo {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  members: { id: string; name: string }[];
}
/** Message privé : comme un message de salon, avec le destinataire. */
export interface DmMsg extends ChatMsg {
  to: { id: string; name: string };
}
/** Annonce à toute la ville (offre d'emploi, tontine, cérémonie d'un joueur ; conférence programmée). */
export interface Announce {
  kind: 'job' | 'tontine' | 'ceremony' | 'conference';
  at: string;
  [k: string]: string | number;
}
/** Joueur en train d'écrire dans un salon (`at` : réception du dernier signal, pour l'effacer s'il se tait). */
export interface TypingWho {
  id: string;
  name: string;
  username: string | null;
  at: number;
}
interface LiveState {
  connected: boolean;
  /** Flux continu indisponible (proxy, hébergement) : les messages sont actualisés par requêtes régulières. */
  polling: boolean;
  online: number;
  players: LivePlayer[];
  /** Tous les joueurs en ligne de la ville (même chez eux ou dans un bâtiment) : liste « Qui est en ligne ». */
  roster: { id: string; name: string; place: string }[];
  /** Messages reçus pendant la session, par salon (les derniers seulement). */
  chat: Record<string, ChatMsg[]>;
  unread: number;
  announces: Announce[];
  /** Mon personnage (pour savoir qui est l'autre dans une conversation privée). */
  me: string | null;
  /** Messages privés reçus ou envoyés pendant la session, par joueur, et non lus par joueur. */
  dms: Record<string, DmMsg[]>;
  dmUnread: Record<string, number>;
  /** Mes groupes (null tant que la liste n'est pas chargée) et messages non lus par groupe. */
  groups: GroupInfo[] | null;
  groupUnread: Record<string, number>;
  /** Qui écrit en ce moment, par salon. */
  typing: Record<string, TypingWho[]>;
}

const MAX_KEEP = 100;
let state: LiveState = { connected: false, polling: false, online: 0, players: [], roster: [], chat: {}, unread: 0, announces: [], me: null, dms: {}, dmUnread: {}, groups: null, groupUnread: {}, typing: {} };
const announceListeners = new Set<(a: Announce) => void>();
const dmListeners = new Set<(m: DmMsg) => void>();
/** Argent reçu d'un autre joueur (envoi de la part de `from`). */
export interface MoneyIn {
  from: string;
  amount: number;
  at: string;
}
const moneyListeners = new Set<(m: MoneyIn) => void>();
/** Résultat d'un marché public (retenue, rejetée, payée), reçu même sans être devant le téléphone. */
export interface TenderEvent {
  kind: 'awarded' | 'rejected' | 'paid';
  company: string;
  sector: string;
  amount: string;
  hours: number;
}
const tenderListeners = new Set<(e: TenderEvent) => void>();
/** Évènement d'un prêt bancaire personnel (accordé, mensualité prélevée, en retard, ou clos), reçu même sans être devant le téléphone. */
export interface LoanEvent {
  kind: 'granted' | 'collected' | 'late' | 'closed';
  amount: string;
  installment: string;
  period: number;
  remaining: string;
}
const loanListeners = new Set<(e: LoanEvent) => void>();
const listeners = new Set<() => void>();
const set = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** Un signal « écrit… » s'efface s'il n'est pas renouvelé (le serveur le garde 6 s ; l'auteur le relance pendant la frappe). */
const TYPING_SHOW_MS = 6_000;
let typingTimer: number | null = null;
function setTypingRoom(room: string, list: TypingWho[]): void {
  const typing = { ...state.typing };
  if (list.length) typing[room] = list;
  else delete typing[room];
  set({ typing });
  if (typingTimer === null && Object.keys(typing).length) {
    typingTimer = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next: Record<string, TypingWho[]> = {};
      for (const [k, v] of Object.entries(state.typing)) {
        const keep = v.filter((w) => now - w.at < TYPING_SHOW_MS);
        if (keep.length !== v.length) changed = true;
        if (keep.length) next[k] = keep;
      }
      if (changed) set({ typing: next });
      if (!Object.keys(next).length && typingTimer !== null) {
        window.clearInterval(typingTimer);
        typingTimer = null;
      }
    }, 1000);
  }
}

function onEvent(e: StreamEvent): void {
  if (e.type === 'presence') {
    const d = e.data as { online: number; players: LivePlayer[] };
    set({ online: d.online, players: Array.isArray(d.players) ? d.players : [], roster: [] });
  } else if (e.type === 'hello') {
    const d = e.data as { online: number; you?: string };
    set({ online: d.online, me: d.you ?? state.me });
  } else if (e.type === 'dm') {
    const m = e.data as DmMsg;
    const peer = m.from.id === state.me ? m.to.id : m.from.id;
    if ((state.dms[peer] ?? []).some((x) => x.id === m.id)) return;
    const list = [...(state.dms[peer] ?? []), m].slice(-MAX_KEEP);
    const mine = m.from.id === state.me;
    set({ dms: { ...state.dms, [peer]: list }, dmUnread: mine ? state.dmUnread : { ...state.dmUnread, [peer]: (state.dmUnread[peer] ?? 0) + 1 } });
    if (!mine) dmListeners.forEach((l) => l(m));
  } else if (e.type === 'group') {
    const m = e.data as ChatMsg & { groupId: string };
    if ((state.chat[m.room] ?? []).some((x) => x.id === m.id)) return;
    const mine = m.from.id === state.me;
    set({ chat: { ...state.chat, [m.room]: [...(state.chat[m.room] ?? []), m].slice(-MAX_KEEP) }, groupUnread: mine ? state.groupUnread : { ...state.groupUnread, [m.groupId]: (state.groupUnread[m.groupId] ?? 0) + 1 } });
  } else if (e.type === 'group_added') {
    live.upsertGroup(e.data as GroupInfo);
  } else if (e.type === 'group_removed') {
    const id = (e.data as { id: string }).id;
    if (state.groups) set({ groups: state.groups.filter((g) => g.id !== id) });
  } else if (e.type === 'money') {
    moneyListeners.forEach((l) => l(e.data as MoneyIn));
  } else if (e.type === 'tender_awarded' || e.type === 'tender_rejected' || e.type === 'tender_paid') {
    const d = e.data as { company: string; sector: string; amount: string; hours: number };
    tenderListeners.forEach((l) => l({ kind: e.type.slice('tender_'.length) as TenderEvent['kind'], ...d }));
  } else if (e.type === 'loan_granted' || e.type === 'loan_collected' || e.type === 'loan_late' || e.type === 'loan_closed') {
    const d = e.data as { amount: string; installment: string; period: number; remaining: string };
    loanListeners.forEach((l) => l({ kind: e.type.slice('loan_'.length) as LoanEvent['kind'], ...d }));
  } else if (e.type === 'typing') {
    const d = e.data as { room: string; id: string; name: string; username: string | null; stop?: boolean };
    if (d.id === state.me) return;
    const rest = (state.typing[d.room] ?? []).filter((w) => w.id !== d.id);
    setTypingRoom(d.room, d.stop ? rest : [...rest, { id: d.id, name: d.name, username: d.username ?? null, at: Date.now() }]);
  } else if (e.type === 'chat') {
    const m = e.data as ChatMsg;
    // Son message est arrivé : il n'écrit plus
    if ((state.typing[m.room] ?? []).some((w) => w.id === m.from.id)) setTypingRoom(m.room, (state.typing[m.room] ?? []).filter((w) => w.id !== m.from.id));
    if ((state.chat[m.room] ?? []).some((x) => x.id === m.id)) return; // déjà affiché à l'envoi
    const list = [...(state.chat[m.room] ?? []), m].slice(-MAX_KEEP);
    set({ chat: { ...state.chat, [m.room]: list }, unread: m.from.id === state.me ? state.unread : state.unread + 1 });
  } else if (e.type === 'announce') {
    const a = e.data as Announce;
    set({ announces: [a, ...state.announces].slice(0, 20), unread: state.unread + 1 });
    announceListeners.forEach((l) => l(a));
  } else if (e.type === 'chat_hidden') {
    const id = (e.data as { id: string }).id;
    const chat: Record<string, ChatMsg[]> = {};
    for (const [k, v] of Object.entries(state.chat)) chat[k] = v.filter((m) => m.id !== id);
    set({ chat });
  }
}

// Synchronisation par requêtes courtes (POST /live/sync). Sur l'hébergement mutualisé, une connexion continue (SSE) par
// joueur bloque un « processus d'entrée » de l'hébergeur pendant toute la partie : à une vingtaine de joueurs, plus rien
// ne passe (envoi de message en erreur, « impossible de joindre le serveur »). Ici, une requête de quelques millisecondes
// toutes les 2 à 3,5 s apporte tout : position du joueur, chat, messages privés, groupes, annonces, présence des voisins.
// Les événements sont numérotés et accusés (`ack`) : une réponse perdue sur un réseau 3G est renvoyée au tour suivant.

/** Cadence quand une conversation est ouverte ou que le joueur se déplace, et cadence de fond. */
const SYNC_FAST_MS = 2000;
const SYNC_SLOW_MS = 3500;
/** Après un échec, attente croissante jusqu'à ce plafond (réseau coupé, serveur qui redémarre). */
const SYNC_MAX_BACKOFF_MS = 30_000;
/** Identifiant de cet onglet : chaque onglet a sa propre file d'événements côté serveur. */
const TAB = (() => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
})();
let running = false;
let ack = 0;
let syncTimer: number | null = null;
let inFlight = false;
let failures = 0;
/** Dernière position à envoyer (posée par la scène, partie avec la prochaine synchronisation). */
let pendingPos: { x: number; z: number; yaw: number; ride?: Ride } | null = null;
let movedAt = 0;
const watchedRooms = new Map<string, number>();
const watchedDms = new Map<string, number>();
const bump = (m: Map<string, number>, k: string, d: number) => {
  const n = (m.get(k) ?? 0) + d;
  if (n <= 0) m.delete(k);
  else m.set(k, n);
};

interface SyncReply {
  seq: number;
  reset: boolean;
  events: { seq: number; type: string; data: unknown }[];
  presence: { online: number; players: LivePlayer[] } | null;
}

/** Recharge les conversations ouvertes : après un redémarrage du serveur, des messages ont pu se perdre entre-temps. */
async function reloadWatched(): Promise<void> {
  for (const room of watchedRooms.keys()) {
    try {
      if (room.startsWith('group:')) {
        const r = await api<{ room: string; group: GroupInfo; messages: ChatMsg[] }>(`/live/groups/${encodeURIComponent(room.slice(6))}/messages`, { auth: true });
        live.seed(r.room, r.messages);
        live.upsertGroup(r.group);
      } else {
        const kind = room.startsWith('city:') ? 'city' : 'place';
        const r = await api<{ room: string; messages: ChatMsg[] }>(`/live/chat?room=${kind}`, { auth: true });
        live.seed(r.room, r.messages);
      }
    } catch {
      /* réseau coupé : rien de grave, les nouveaux messages arrivent quand même */
    }
  }
  for (const peer of watchedDms.keys()) {
    try {
      const r = await api<{ messages: DmMsg[] }>(`/live/dm?with=${encodeURIComponent(peer)}`, { auth: true });
      live.seedDm(peer, r.messages);
    } catch {
      /* idem */
    }
  }
}

function nextDelay(): number {
  if (failures > 0) return Math.min(SYNC_MAX_BACKOFF_MS, 2000 * 2 ** Math.min(failures - 1, 4));
  const busy = watchedRooms.size > 0 || watchedDms.size > 0 || Date.now() - movedAt < 4000;
  return busy ? SYNC_FAST_MS : SYNC_SLOW_MS;
}

function schedule(ms = nextDelay()): void {
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = running && !document.hidden ? window.setTimeout(() => void syncOnce(), ms) : null;
}

async function syncOnce(): Promise<void> {
  syncTimer = null;
  if (!running || inFlight || document.hidden) return;
  inFlight = true;
  const pos = pendingPos;
  pendingPos = null;
  try {
    const r = await api<SyncReply>('/live/sync', { method: 'POST', body: { tab: TAB, ack, ...(pos ?? {}) }, auth: true });
    if (!running) return;
    if (r.reset) {
      // File neuve côté serveur (redémarrage) : on repart de zéro et on relit les conversations ouvertes
      ack = 0;
      void reloadWatched();
    }
    for (const e of r.events) {
      if (e.seq <= ack) continue;
      ack = e.seq;
      onEvent({ type: e.type, data: e.data });
    }
    if (r.presence) onEvent({ type: 'presence', data: r.presence });
    failures = 0;
    if (!state.connected) set({ connected: true, polling: false });
  } catch {
    failures++;
    if (pos && !pendingPos) pendingPos = pos;
    if (failures >= 2 && state.connected) set({ connected: false });
  } finally {
    inFlight = false;
    schedule();
  }
}

/** Retour sur l'appli (écran rallumé, onglet revenu) : synchronisation immédiate. */
function onVisibility(): void {
  if (!running) return;
  if (document.hidden) schedule();
  else {
    failures = 0;
    schedule(0);
  }
}
function onOnline(): void {
  if (!running) return;
  failures = 0;
  schedule(0);
}

/** Erreur passagère : réseau coupé, serveur saturé ou qui redémarre (le message n'a pas abouti, on peut réessayer). */
const retryable = (e: unknown) => e instanceof ApiError && (e.code === 'network_error' || e.status === 0 || e.status === 429 || e.status >= 500);

export const live = {
  start(): void {
    if (running) return;
    running = true;
    ack = 0;
    failures = 0;
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    schedule(0);
  },
  stop(): void {
    running = false;
    if (syncTimer !== null) window.clearTimeout(syncTimer);
    syncTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    set({ connected: false, polling: false, players: [], roster: [], online: 0 });
  },
  /** Relance immédiate (bouton « Réessayer » du chat). */
  retry(): void {
    failures = 0;
    if (running) schedule(0);
    else live.start();
  },
  /**
   * Envoie un message (salon, privé ou groupe) avec un identifiant choisi ici : sur un réseau qui décroche, la requête est
   * réessayée deux fois avec le même identifiant, et le serveur ne publie jamais le message en double.
   */
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const cid = crypto.randomUUID ? crypto.randomUUID() : idempotencyKey().replace(/^(.{8})(.{4})(.{3})(.{3})(.{12}).*$/, '$1-$2-4$3-a$4-$5');
    const waits = [1500, 4000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await api<T>(path, { method: 'POST', body: { ...body, cid }, auth: true });
      } catch (e) {
        if (!retryable(e) || attempt >= waits.length) throw e;
        await new Promise((r) => setTimeout(r, waits[attempt]));
      }
    }
  },
  /** Message que je viens d'envoyer : sans flux continu, il est ajouté tout de suite (avec le flux, il arrive par l'événement). */
  sent(msg: ChatMsg | DmMsg, peer?: string): void {
    // Affiché dès que le serveur l'accepte, sans attendre l'écho du flux (souvent retardé par l'hébergement) ; l'écho est ignoré (même id)
    if (peer) {
      const cur = state.dms[peer] ?? [];
      if (!cur.some((x) => x.id === msg.id)) set({ dms: { ...state.dms, [peer]: [...cur, msg as DmMsg].slice(-MAX_KEEP) } });
    } else {
      const cur = state.chat[msg.room] ?? [];
      if (!cur.some((x) => x.id === msg.id)) set({ chat: { ...state.chat, [msg.room]: [...cur, msg].slice(-MAX_KEEP) } });
    }
  },
  /** Une conversation de salon est ouverte : synchronisation plus rapprochée tant qu'elle l'est. Retourne l'arrêt du suivi. */
  watchRoom(room: string): () => void {
    bump(watchedRooms, room, 1);
    if (running) schedule(Math.min(nextDelay(), 300));
    return () => bump(watchedRooms, room, -1);
  },
  /** Idem pour une conversation privée. */
  watchDm(peer: string): () => void {
    bump(watchedDms, peer, 1);
    if (running) schedule(Math.min(nextDelay(), 300));
    return () => bump(watchedDms, peer, -1);
  },
  /** Fusionne l'historique chargé avec les messages reçus en direct (sans doublon). */
  seed(room: string, messages: ChatMsg[]): void {
    const seen = new Set(messages.map((m) => m.id));
    const merged = [...messages, ...(state.chat[room] ?? []).filter((m) => !seen.has(m.id))].slice(-MAX_KEEP);
    set({ chat: { ...state.chat, [room]: merged } });
  },
  /** Qui écrit dans un salon, d'après le serveur (mode sans flux continu, ou chargement de l'historique). */
  setTyping(room: string, who: Omit<TypingWho, 'at'>[] | undefined): void {
    if (!Array.isArray(who)) return;
    const now = Date.now();
    const list = who.filter((w) => w.id !== state.me).map((w) => ({ id: w.id, name: w.name, username: w.username ?? null, at: now }));
    if (list.length || state.typing[room]) setTypingRoom(room, list);
  },
  /** Historique d'une conversation privée, fusionné avec les messages reçus en direct. */
  seedDm(peer: string, messages: DmMsg[]): void {
    const seen = new Set(messages.map((m) => m.id));
    const merged = [...messages, ...(state.dms[peer] ?? []).filter((m) => !seen.has(m.id))].slice(-MAX_KEEP);
    set({ dms: { ...state.dms, [peer]: merged } });
  },
  /** Liste de mes groupes chargée depuis le serveur. */
  setGroups(groups: GroupInfo[]): void {
    set({ groups });
  },
  /** Ajoute ou met à jour un groupe (création, nouveau membre, nouveau propriétaire). */
  upsertGroup(g: GroupInfo): void {
    const rest = (state.groups ?? []).filter((x) => x.id !== g.id);
    set({ groups: [g, ...rest].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) });
  },
  removeGroup(id: string): void {
    if (state.groups) set({ groups: state.groups.filter((g) => g.id !== id) });
  },
  markGroupRead(id: string): void {
    if (state.groupUnread[id]) set({ groupUnread: { ...state.groupUnread, [id]: 0 } });
  },
  markDmRead(peer: string): void {
    if (state.dmUnread[peer]) set({ dmUnread: { ...state.dmUnread, [peer]: 0 } });
  },
  /** Notifié à chaque message privé reçu (pour proposer de répondre). */
  onDm(l: (m: DmMsg) => void): () => void {
    dmListeners.add(l);
    return () => dmListeners.delete(l);
  },
  /** Notifié quand un autre joueur t'envoie de l'argent. */
  onMoney(l: (m: MoneyIn) => void): () => void {
    moneyListeners.add(l);
    return () => moneyListeners.delete(l);
  },
  /** Notifié du résultat d'un marché public (retenue, rejetée, payée). */
  onTender(l: (e: TenderEvent) => void): () => void {
    tenderListeners.add(l);
    return () => tenderListeners.delete(l);
  },
  /** Notifié d'un évènement sur mon prêt (accordé, mensualité prélevée, en retard, clos). */
  onLoan(l: (e: LoanEvent) => void): () => void {
    loanListeners.add(l);
    return () => loanListeners.delete(l);
  },
  markRead(): void {
    if (state.unread) set({ unread: 0 });
  },
  /** Notifié à chaque nouvelle annonce (pour l'afficher en bandeau). */
  onAnnounce(l: (a: Announce) => void): () => void {
    announceListeners.add(l);
    return () => announceListeners.delete(l);
  },
  get(): LiveState {
    return state;
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useLive(): LiveState {
  return useSyncExternalStore(live.subscribe, live.get, live.get);
}

let lastPos: { x: number; z: number; at: number; ride?: Ride | null } = { x: NaN, z: NaN, at: 0 };
/** Dernière position envoyée (pour trouver les joueurs tout proches). */
export const myPosition = () => lastPos;
/**
 * Position du joueur : partira avec la prochaine synchronisation (pas de requête à part). Retenue seulement si elle a
 * changé, ou toutes les 10 s ; un changement de véhicule (monter dans le bus, en descendre) déclenche un envoi immédiat.
 */
export function sendPosition(x: number, z: number, yaw: number, ride: Ride | null = null): void {
  const now = Date.now();
  const moved = Math.hypot(x - lastPos.x, z - lastPos.z) > 0.3 || Number.isNaN(lastPos.x);
  const boarded = ride !== (lastPos.ride ?? null);
  if (!boarded && (now - lastPos.at < 1000 || (!moved && now - lastPos.at < 10_000))) return;
  lastPos = { x, z, at: now, ride };
  if (moved) movedAt = now;
  const r = (n: number) => Math.round(n * 10) / 10;
  pendingPos = { x: r(x), z: r(z), yaw: r(((yaw % 6.283) + 6.283) % 6.283 - 3.1415), ...(ride ? { ride } : {}) };
  if (boarded && running) schedule(0);
}
