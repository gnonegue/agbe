import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, type MessageEvent } from '@nestjs/common';
import { Subject, type Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../common/audit.service';
import { sha256Hex } from '../common/crypto';
import { checkMessage, REPORT_REASONS, type ReportReason } from './filter';

export type RoomKind = 'city' | 'place';
/** Véhicule à bord duquel un joueur se déplace (MOTO : sa propre moto, sans conducteur devant lui). */
export const RIDES = ['ZEM', 'MOTO', 'WORO', 'BUS', 'CAR'] as const;
export type Ride = (typeof RIDES)[number];

interface Client {
  id: number;
  accountId: string;
  characterId: string;
  name: string;
  look: unknown;
  city: string;
  place: string;
  out: Subject<MessageEvent>;
}

interface Position {
  x: number;
  z: number;
  yaw: number;
  ride: Ride | null;
  at: number;
}

/** Durée après laquelle une position non rafraîchie n'est plus montrée (joueur parti ou onglet en veille). */
const STALE_MS = 15_000;
const TICK_MS = 2_000;
const PLACE_REFRESH_MS = 5_000;
const KEEPALIVE_MS = 20_000;
/** Un signal « en train d'écrire » vaut tant de temps (le client le renouvelle pendant la frappe). */
const TYPING_MS = 6_000;
const TYPING_MIN_INTERVAL_MS = 1_500;
/** Taille des cases de la grille de présence et nombre maximal d'anneaux explorés autour d'un joueur. */
const GRID_CELL = 25;
const MAX_RINGS = 40;
const cellKey = (gx: number, gz: number): number => (gx + 4096) * 8192 + (gz + 4096);
/** Une position plus rapprochée que ça est ignorée (protège le hub d'un client trop bavard). */
const MIN_POS_INTERVAL_MS = 400;
/** Joueur connecté par requêtes régulières (hébergement qui bloque le flux continu) : en ligne tant qu'il a interrogé la présence depuis moins de ce délai. */
const POLLED_TTL_MS = 25_000;
/** Fiche d'un joueur gardée en mémoire entre deux interrogations de présence. */
const POLLED_INFO_MS = 30_000;
/** Boîte aux lettres d'un onglet synchronisé (/live/sync) : fermée sans nouvelle de lui pendant ce délai. */
const MAILBOX_TTL_MS = 30_000;
/** Événements gardés pour un onglet en attendant qu'il les relève (3G qui décroche) ; au-delà, les plus anciens tombent. */
const MAILBOX_MAX = 300;
/** Deux synchronisations du même onglet plus rapprochées que ça : la seconde ne fait rien (client trop bavard). */
const SYNC_MIN_INTERVAL_MS = 600;
/** Nouveaux onglets synchronisés acceptés par compte et par minute (chacun lit la base) : au-delà, refusés. */
const NEW_TABS_PER_MINUTE = 10;
/** Un message renvoyé avec le même identifiant client pendant ce délai n'est pas publié deux fois (réessai sur 3G). */
const CLIENT_ID_TTL_MS = 10 * 60_000;

/**
 * Boîte aux lettres d'un onglet en mode « synchronisation » : les événements du hub (chat, messages privés, annonces…)
 * y attendent la prochaine requête de l'onglet. Chaque événement a un numéro ; le client renvoie le dernier reçu (`ack`)
 * et le serveur ne jette qu'après cet accusé, si bien qu'une réponse perdue en route est simplement renvoyée.
 */
interface Mailbox {
  key: string;
  accountId: string;
  close: () => void;
  sub: Subscription;
  seq: number;
  events: { seq: number; type: string; data: unknown }[];
  /** Dernière présence calculée (remplacée à chaque tour : seule la plus récente compte) et si elle a déjà été envoyée. */
  presence: unknown;
  presenceSent: boolean;
  lastSync: number;
}

/**
 * Hub temps réel en mémoire : flux SSE par joueur connecté, présence (positions) et diffusion du chat.
 * Une seule instance du back : en multi-instance, remplacer la diffusion par Redis pub/sub (voir docs/API.md).
 */
@Injectable()
export class LiveService implements OnModuleDestroy {
  private readonly logger = new Logger('Live');
  private readonly clients = new Map<number, Client>();
  private readonly positions = new Map<string, Position>();
  private readonly lastPost = new Map<string, number>();
  /** Compte → personnage des joueurs connectés : évite une requête SQL à chaque envoi de position. */
  private readonly charByAccount = new Map<string, string>();
  /** Joueurs en ligne sans flux continu (mode de secours par requêtes) : personnage → dernière interrogation. */
  private readonly polled = new Map<string, { accountId: string; characterId: string; name: string; look: unknown; city: string; place: string; at: number; infoAt: number }>();
  private seq = 0;
  /** Joueurs en train d'écrire, par salon : personnage → (nom, pseudo, instant du dernier signal). Effacé après TYPING_MS. */
  private readonly typingByRoom = new Map<string, Map<string, { id: string; name: string; username: string | null; at: number }>>();
  private readonly timers: NodeJS.Timeout[];
  /** Onglets en mode synchronisation (compte + identifiant d'onglet → boîte aux lettres). */
  private readonly mailboxes = new Map<string, Mailbox>();
  /** Messages déjà publiés par identifiant client (personnage + id) : un réessai renvoie le même message. */
  private readonly sentByClientId = new Map<string, { at: number; msg: unknown }>();
  /** Ouvertures récentes de boîtes aux lettres par compte (instants), pour borner les identifiants d'onglet inventés. */
  private readonly tabOpenings = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {
    this.timers = [
      setInterval(() => void this.tickPresence(), TICK_MS),
      setInterval(() => void this.refreshPlaces(), PLACE_REFRESH_MS),
      setInterval(() => this.broadcastAll({ type: 'ping', data: {} }), KEEPALIVE_MS),
      setInterval(() => this.sweepMailboxes(), 10_000),
    ];
    for (const t of this.timers) t.unref();
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.clients.values()) c.out.complete();
    this.clients.clear();
    this.mailboxes.clear();
  }

  /** Onglets synchronisés silencieux depuis trop longtemps (fermés, téléphone en veille) : retirés du hub. */
  private sweepMailboxes(): void {
    const now = Date.now();
    for (const mb of this.mailboxes.values()) if (now - mb.lastSync > MAILBOX_TTL_MS) this.dropMailbox(mb);
    for (const [k, v] of this.sentByClientId) if (now - v.at > CLIENT_ID_TTL_MS) this.sentByClientId.delete(k);
    for (const [k, v] of this.tabOpenings) if (v.every((t) => now - t > 60_000)) this.tabOpenings.delete(k);
  }

  private dropMailbox(mb: Mailbox): void {
    if (this.mailboxes.get(mb.key) !== mb) return;
    this.mailboxes.delete(mb.key);
    mb.sub.unsubscribe();
    mb.close();
  }

  /**
   * Synchronisation par requêtes courtes (hébergement mutualisé : une connexion continue par joueur y épuise vite les
   * processus d'entrée). Une seule requête toutes les 2 à 4 s fait tout : position du joueur (facultative), événements
   * en attente depuis le dernier accusé `ack`, et présence des voisins si elle a changé.
   */
  async sync(accountId: string, tab: string, ack: number, pos?: { x: number; z: number; yaw: number; ride: Ride | null }) {
    const key = `${accountId}:${tab}`;
    const now = Date.now();
    let mb = this.mailboxes.get(key);
    let fresh = false;
    if (!mb) {
      // Identifiants d'onglet inventés à la chaîne : chaque nouvelle boîte lit la base, on en borne le rythme
      const recent = (this.tabOpenings.get(accountId) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= NEW_TABS_PER_MINUTE) throw new HttpException('too_many_requests', HttpStatus.TOO_MANY_REQUESTS);
      recent.push(now);
      this.tabOpenings.set(accountId, recent);
      // Au plus 4 onglets synchronisés par compte : le plus ancien laisse sa place
      const mine = [...this.mailboxes.values()].filter((m) => m.accountId === accountId).sort((a, b) => a.lastSync - b.lastSync);
      for (const old of mine.slice(0, Math.max(0, mine.length - 3))) this.dropMailbox(old);
      const h = await this.connect(accountId);
      const box: Mailbox = { key, accountId, close: h.close, sub: null as unknown as Subscription, seq: 0, events: [], presence: null, presenceSent: true, lastSync: now };
      box.sub = h.out.subscribe({
        next: (ev) => {
          if (ev.type === 'ping') return;
          if (ev.type === 'presence') {
            box.presence = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
            box.presenceSent = false;
            return;
          }
          box.events.push({ seq: ++box.seq, type: String(ev.type), data: ev.data });
          if (box.events.length > MAILBOX_MAX) box.events.splice(0, box.events.length - MAILBOX_MAX);
        },
        // Flux fermé par le hub (trop d'onglets pour ce compte) : la boîte disparaît, l'onglet en rouvrira une
        complete: () => {
          if (this.mailboxes.get(key) === box) {
            this.mailboxes.delete(key);
            box.sub?.unsubscribe();
          }
        },
      });
      this.mailboxes.set(key, box);
      box.events.push({ seq: ++box.seq, type: 'hello', data: h.hello.data });
      mb = box;
      fresh = true;
    }
    const tooSoon = !fresh && now - mb.lastSync < SYNC_MIN_INTERVAL_MS;
    mb.lastSync = now;
    if (pos) await this.setPosition(accountId, pos.x, pos.z, pos.yaw, pos.ride);
    // Accusé de réception : les événements déjà reçus par l'onglet sont oubliés. Un accusé plus grand que le dernier
    // numéro vient d'une ancienne boîte (serveur redémarré) : l'onglet repart de zéro (`reset`).
    const reset = ack > mb.seq;
    if (!reset) mb.events = mb.events.filter((e) => e.seq > ack);
    if (tooSoon) return { seq: mb.seq, reset, events: [], presence: null };
    const presence = mb.presenceSent ? null : mb.presence;
    mb.presenceSent = true;
    return { seq: mb.seq, reset, events: mb.events, presence };
  }

  /** Message déjà publié avec cet identifiant client (réessai après une coupure) : renvoyé tel quel, sans doublon. */
  private replayed<T>(characterId: string, cid: string | undefined): T | null {
    if (!cid) return null;
    return (this.sentByClientId.get(`${characterId}:${cid}`)?.msg as T | undefined) ?? null;
  }

  private remember<T>(characterId: string, cid: string | undefined, msg: T): T {
    if (cid) this.sentByClientId.set(`${characterId}:${cid}`, { at: Date.now(), msg });
    return msg;
  }

  static roomOf(kind: RoomKind, c: { city: string; place: string }): string {
    return kind === 'city' ? `city:${c.city}` : `place:${c.place}`;
  }

  private async characterOf(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true, name: true, look: true, locationId: true, city: true, mutedUntil: true, account: { select: { guest: true, createdAt: true, username: true } } } });
    if (!c) throw new NotFoundException('no_character');
    return c;
  }

  /** Ouvre le flux d'un joueur ; `close` le retire du hub (déconnexion). */
  async connect(accountId: string): Promise<{ out: Subject<MessageEvent>; close: () => void; hello: MessageEvent }> {
    const c = await this.characterOf(accountId);
    const out = new Subject<MessageEvent>();
    const id = ++this.seq;
    // Au plus 4 flux ouverts par compte : le plus ancien est fermé (onglets oubliés, reconnexions en rafale)
    const mine = [...this.clients.values()].filter((x) => x.accountId === accountId);
    for (const old of mine.slice(0, Math.max(0, mine.length - 3))) {
      old.out.complete();
      this.clients.delete(old.id);
    }
    this.charByAccount.set(accountId, c.id);
    this.clients.set(id, { id, accountId, characterId: c.id, name: c.name, look: c.look, city: c.city, place: c.locationId, out });
    return {
      out,
      // Premier événement, émis par l'appelant une fois abonné (sinon il serait perdu)
      hello: { type: 'hello', data: { you: c.id, online: this.onlineCount() } },
      close: () => {
        this.clients.delete(id);
        if (![...this.clients.values()].some((x) => x.accountId === accountId)) this.charByAccount.delete(accountId);
        if (![...this.clients.values()].some((x) => x.characterId === c.id)) this.positions.delete(c.id);
      },
    };
  }

  /** Chiffres du hub pour le diagnostic d'exploitation. */
  stats() {
    let streams = 0;
    const boxed = new Set([...this.mailboxes.values()].map((m) => m.accountId));
    for (const c of this.clients.values()) if (!boxed.has(c.accountId)) streams++;
    return { online: this.onlineCount(), syncTabs: this.mailboxes.size, streams, polledFallback: this.freshPolled().length };
  }

  /** Comptes connectés au jeu en ce moment (flux temps réel ouvert) : « en ligne » pour l'administration. */
  onlineAccountIds(): Set<string> {
    return new Set([...[...this.clients.values()].map((c) => c.accountId), ...this.freshPolled().map((p) => p.accountId)]);
  }

  /** Joueurs en mode de secours encore actifs (purge les anciens au passage). */
  private freshPolled() {
    const now = Date.now();
    for (const [k, p] of this.polled) if (now - p.at > POLLED_TTL_MS) this.polled.delete(k);
    return [...this.polled.values()];
  }

  /** Comptes connectés qui ont envoyé une position dans la dernière minute : ils sont en train de jouer (onglet actif). */
  playingAccountIds(withinMs = 60_000): Set<string> {
    const now = Date.now();
    const out = new Set<string>();
    for (const c of this.clients.values()) {
      const pos = this.positions.get(c.characterId);
      if (pos && now - pos.at <= withinMs) out.add(c.accountId);
    }
    for (const p of this.freshPolled()) {
      const pos = this.positions.get(p.characterId);
      if (pos && now - pos.at <= withinMs) out.add(p.accountId);
    }
    return out;
  }

  onlineCount(): number {
    return new Set([...[...this.clients.values()].map((c) => c.characterId), ...this.freshPolled().map((p) => p.characterId)]).size;
  }

  /**
   * Présence par requête (mode de secours quand le flux continu est bloqué par l'hébergement) : enregistre l'appelant comme
   * en ligne, puis renvoie le nombre de joueurs en ligne, les voisins avec position (pour les dessiner) et la liste de tous
   * les joueurs de la ville (pour « Qui est en ligne », même s'ils sont chez eux ou dans un bâtiment).
   */
  async presenceSnapshot(accountId: string) {
    const now = Date.now();
    let me = [...this.polled.values()].find((p) => p.accountId === accountId);
    if (!me || now - me.infoAt > POLLED_INFO_MS) {
      const c = await this.characterOf(accountId);
      me = { accountId, characterId: c.id, name: c.name, look: c.look, city: c.city, place: c.locationId, at: now, infoAt: now };
    }
    me.at = now;
    this.polled.set(me.characterId, me);
    this.charByAccount.set(accountId, me.characterId);
    const max = (await this.settings.get('chat')).presenceMax;
    // Tous les joueurs en ligne, par personnage : flux continu ou mode de secours
    const all = new Map<string, { characterId: string; name: string; look: unknown; city: string; place: string }>();
    for (const c of this.clients.values()) all.set(c.characterId, c);
    for (const p of this.freshPolled()) if (!all.has(p.characterId)) all.set(p.characterId, p);
    const mine = this.positions.get(me.characterId);
    const others = [...all.values()].filter((o) => o.characterId !== me!.characterId && o.city === me!.city);
    const players = others
      .flatMap((o) => {
        const p = this.positions.get(o.characterId);
        return p && now - p.at <= STALE_MS ? [{ o, p, d: mine ? Math.hypot(p.x - mine.x, p.z - mine.z) : 0 }] : [];
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, max)
      .map(({ o, p }) => ({ id: o.characterId, name: o.name, look: o.look, x: p.x, z: p.z, yaw: p.yaw, ride: p.ride, place: o.place }));
    const roster = others.slice(0, 200).map((o) => ({ id: o.characterId, name: o.name, place: o.place }));
    return { online: all.size, players, roster };
  }

  /** Position envoyée par le client (affichage seulement : aucune règle de jeu n'en dépend). */
  async setPosition(accountId: string, x: number, z: number, yaw: number, ride: Ride | null = null) {
    let cid = this.charByAccount.get(accountId);
    if (!cid) {
      const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
      if (!c) throw new NotFoundException('no_character');
      cid = c.id;
    }
    const now = Date.now();
    const prev = this.positions.get(cid);
    if (prev && now - prev.at < MIN_POS_INTERVAL_MS && prev.ride === ride) return { ok: true };
    this.positions.set(cid, { x, z, yaw, ride, at: now });
    return { ok: true };
  }

  private async tickPresence(): Promise<void> {
    if (this.clients.size === 0) return;
    const now = Date.now();
    for (const [k, p] of this.positions) if (now - p.at > STALE_MS * 4) this.positions.delete(k);
    const max = (await this.settings.get('chat')).presenceMax;
    const byChar = new Map<string, Client>();
    for (const c of this.clients.values()) byChar.set(c.characterId, c);
    // Grille spatiale par ville : chaque joueur ne regarde que les cases voisines (et non tous les connectés de sa ville)
    type Entry = { client: Client; p: Position };
    const grids = new Map<string, Map<number, Entry[]>>();
    for (const [cid, p] of this.positions) {
      if (now - p.at > STALE_MS) continue;
      const o = byChar.get(cid);
      if (!o) continue;
      let grid = grids.get(o.city);
      if (!grid) grids.set(o.city, (grid = new Map()));
      const key = cellKey(Math.floor(p.x / GRID_CELL), Math.floor(p.z / GRID_CELL));
      const list = grid.get(key);
      if (list) list.push({ client: o, p });
      else grid.set(key, [{ client: o, p }]);
    }
    const fragments = new Map<string, string>();
    for (const c of this.clients.values()) {
      const me = this.positions.get(c.characterId);
      const grid = grids.get(c.city);
      const near: { o: Client; p: Position; d: number }[] = [];
      if (grid) {
        if (me) {
          // Anneaux de cases autour du joueur jusqu'à avoir assez de voisins, plus un anneau de marge pour bien les classer
          const cx = Math.floor(me.x / GRID_CELL), cz = Math.floor(me.z / GRID_CELL);
          let enough = -1;
          for (let r = 0; r <= MAX_RINGS; r++) {
            const visit = (gx: number, gz: number): void => {
              for (const e of grid.get(cellKey(gx, gz)) ?? []) if (e.client.characterId !== c.characterId) near.push({ o: e.client, p: e.p, d: Math.hypot(e.p.x - me.x, e.p.z - me.z) });
            };
            if (r === 0) visit(cx, cz);
            else {
              for (let k = -r; k <= r; k++) {
                visit(cx + k, cz - r);
                visit(cx + k, cz + r);
              }
              for (let k = -r + 1; k <= r - 1; k++) {
                visit(cx - r, cz + k);
                visit(cx + r, cz + k);
              }
            }
            if (enough < 0 && near.length >= max) enough = r;
            if (enough >= 0 && r > enough) break;
          }
        } else {
          // Position inconnue : un échantillon de la ville suffit
          for (const list of grid.values()) {
            for (const e of list) if (e.client.characterId !== c.characterId) near.push({ o: e.client, p: e.p, d: 0 });
            if (near.length >= max) break;
          }
        }
      }
      near.sort((a, b) => a.d - b.d);
      // Chaque joueur n'est sérialisé qu'une fois par diffusion, quel que soit le nombre de voisins qui le voient
      const frags = near.slice(0, max).map(({ o, p }) => {
        let f = fragments.get(o.characterId);
        if (f === undefined) fragments.set(o.characterId, (f = JSON.stringify({ id: o.characterId, name: o.name, look: o.look, x: p.x, z: p.z, yaw: p.yaw, ride: p.ride, place: o.place })));
        return f;
      });
      c.out.next({ type: 'presence', data: `{"online":${byChar.size},"players":[${frags.join(',')}]}` });
    }
  }

  /** Lieu courant des joueurs connectés (changé par les trajets), relu périodiquement. */
  private async refreshPlaces(): Promise<void> {
    if (this.clients.size === 0) return;
    const ids = [...new Set([...this.clients.values()].map((c) => c.characterId))];
    try {
      const rows = await this.prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true, locationId: true, city: true, name: true, look: true } });
      const m = new Map(rows.map((r) => [r.id, r]));
      for (const c of this.clients.values()) {
        const r = m.get(c.characterId);
        if (r) Object.assign(c, { place: r.locationId, city: r.city, name: r.name, look: r.look });
      }
    } catch (e) {
      this.logger.warn(`refreshPlaces: ${(e as Error).message}`);
    }
  }

  /**
   * Annonce aux joueurs connectés d'une ville (offre d'emploi, tontine qui recrute, cérémonie, conférence…).
   * Le client compose le texte traduit à partir de `kind` et des données.
   */
  announce(city: string, kind: 'job' | 'tontine' | 'ceremony' | 'conference', data: Record<string, string | number>): void {
    const ev: MessageEvent = { type: 'announce', data: { kind, at: new Date().toISOString(), ...data } };
    for (const c of this.clients.values()) if (c.city === city) c.out.next(ev);
  }

  /** Notification privée à un joueur connecté (argent reçu…). `false` s'il n'est pas en ligne : il la verra à sa prochaine connexion. */
  notifyCharacter(characterId: string, type: string, data: Record<string, string | number>): boolean {
    let sent = false;
    for (const c of this.clients.values()) {
      if (c.characterId === characterId) {
        c.out.next({ type, data: { at: new Date().toISOString(), ...data } });
        sent = true;
      }
    }
    return sent;
  }

  private broadcastAll(ev: MessageEvent): void {
    for (const c of this.clients.values()) c.out.next(ev);
  }

  private broadcastRoom(room: string, ev: MessageEvent): void {
    for (const c of this.clients.values()) if (LiveService.roomOf('city', c) === room || LiveService.roomOf('place', c) === room) c.out.next(ev);
  }

  /** Citations (nom et début du texte) des messages auxquels répondent `rows`, en une seule requête. */
  private async quotes(rows: { replyToId: string | null }[]): Promise<Map<string, { id: string; name: string; text: string }>> {
    const ids = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const orig = await this.prisma.chatMessage.findMany({ where: { id: { in: ids } }, select: { id: true, text: true, hidden: true, character: { select: { name: true } } } });
    return new Map(orig.map((o) => [o.id, { id: o.id, name: o.character.name, text: o.hidden ? '…' : o.text.slice(0, 90) }]));
  }

  /** Message cité : doit exister, être visible et appartenir au même salon. */
  private async replyTarget(room: string, replyTo?: string): Promise<{ id: string; name: string; text: string } | null> {
    if (!replyTo) return null;
    const o = await this.prisma.chatMessage.findFirst({ where: { id: replyTo, room, hidden: false }, select: { id: true, text: true, character: { select: { name: true } } } });
    if (!o) throw new BadRequestException('reply_unknown');
    return { id: o.id, name: o.character.name, text: o.text.slice(0, 90) };
  }

  /** Forme d'un message envoyée au client (`money` : montant d'un envoi d'argent tracé dans la conversation, sinon null). */
  private shape(m: { id: string; text: string; createdAt: Date; replyToId: string | null; moneyAmount: bigint | null; character: { id: string; name: string; account?: { username: string | null } | null } }, room: string, q: Map<string, { id: string; name: string; text: string }>) {
    const { account, ...who } = m.character;
    const from = account !== undefined ? { ...who, username: account?.username ?? null } : who;
    return { id: m.id, room, from, text: m.text, at: m.createdAt.toISOString(), replyTo: m.replyToId ? q.get(m.replyToId) ?? null : null, money: m.moneyAmount?.toString() ?? null };
  }

  async history(accountId: string, kind: RoomKind) {
    const c = await this.characterOf(accountId);
    const room = LiveService.roomOf(kind, { city: c.city, place: c.locationId });
    const size = (await this.settings.get('chat')).historySize;
    const rows = await this.prisma.chatMessage.findMany({
      where: { room, hidden: false },
      orderBy: { createdAt: 'desc' },
      take: size,
      include: { character: { select: { id: true, name: true, account: { select: { username: true } } } } },
    });
    const q = await this.quotes(rows);
    return { room, messages: rows.reverse().map((m) => this.shape(m, m.room, q)), typing: this.typingIn(room, c.id) };
  }

  /** Contrôles communs avant d'écrire : compte vérifié, pas muet, pas trop récent, pas trop vite, texte filtré. */
  private async checkedText(c: Awaited<ReturnType<LiveService['characterOf']>>, raw: string): Promise<string> {
    const cfg = await this.settings.get('chat');
    if (c.account.guest) throw new ForbiddenException('account_required');
    if (c.mutedUntil && c.mutedUntil.getTime() > Date.now()) throw new ForbiddenException('chat_muted');
    if (Date.now() - c.account.createdAt.getTime() < cfg.minAccountAgeHours * 3_600_000) throw new ForbiddenException('chat_account_too_new');
    const last = this.lastPost.get(c.id) ?? 0;
    if (Date.now() - last < cfg.minIntervalSeconds * 1000) throw new BadRequestException('chat_too_fast');
    const v = checkMessage(raw, cfg);
    if (!v.ok) throw new BadRequestException(v.code);
    this.lastPost.set(c.id, Date.now());
    return v.text;
  }

  /** Salon privé entre deux joueurs (même nom quel que soit l'ordre). */
  static dmRoom(a: string, b: string): string {
    return 'dm:' + sha256Hex([a, b].sort().join(':')).slice(0, 40);
  }

  private async peer(me: string, otherId: string) {
    if (otherId === me) throw new BadRequestException('dm_self');
    const o = await this.prisma.character.findUnique({ where: { id: otherId }, select: { id: true, name: true } });
    if (!o) throw new NotFoundException('unknown_player');
    return o;
  }

  /** Conversation privée avec un joueur (derniers messages). */
  async dmHistory(accountId: string, withId: string) {
    const c = await this.characterOf(accountId);
    const o = await this.peer(c.id, withId);
    const room = LiveService.dmRoom(c.id, o.id);
    const rows = await this.prisma.chatMessage.findMany({ where: { room, hidden: false }, orderBy: { createdAt: 'desc' }, take: (await this.settings.get('chat')).historySize, include: { character: { select: { id: true, name: true } } } });
    const q = await this.quotes(rows);
    // Chaque message privé porte son destinataire, comme en direct (le client s'en sert pour nommer la conversation)
    const me = { id: c.id, name: c.name };
    return { with: o, messages: rows.reverse().map((m) => ({ ...this.shape(m, room, q), to: m.characterId === c.id ? o : me })) };
  }

  /** Message privé : enregistré, puis envoyé en direct aux deux joueurs (tous leurs onglets). */
  async dmPost(accountId: string, toId: string, raw: string, replyTo?: string, cid?: string) {
    const c = await this.characterOf(accountId);
    const again = this.replayed<object>(c.id, cid);
    if (again) return again;
    const o = await this.peer(c.id, toId);
    const text = await this.checkedText(c, raw);
    const room = LiveService.dmRoom(c.id, o.id);
    const quote = await this.replyTarget(room, replyTo);
    const m = await this.prisma.chatMessage.create({ data: { room, characterId: c.id, text, replyToId: quote?.id ?? null } });
    const msg = { id: m.id, room, from: { id: c.id, name: c.name }, to: o, text: m.text, at: m.createdAt.toISOString(), replyTo: quote, money: null };
    for (const cl of this.clients.values()) if (cl.characterId === c.id || cl.characterId === o.id) cl.out.next({ type: 'dm', data: msg });
    return this.remember(c.id, cid, msg);
  }

  async post(accountId: string, kind: RoomKind, raw: string, replyTo?: string, cid?: string) {
    const c = await this.characterOf(accountId);
    const again = this.replayed<object>(c.id, cid);
    if (again) return again;
    const text = await this.checkedText(c, raw);
    const room = LiveService.roomOf(kind, { city: c.city, place: c.locationId });
    const quote = await this.replyTarget(room, replyTo);
    const m = await this.prisma.chatMessage.create({ data: { room, characterId: c.id, text, replyToId: quote?.id ?? null } });
    const msg = { id: m.id, room, from: { id: c.id, name: c.name, username: c.account.username ?? null }, text: m.text, at: m.createdAt.toISOString(), replyTo: quote, money: null };
    // Le message part : l'auteur n'est plus « en train d'écrire »
    if (this.typingByRoom.get(room)?.delete(c.id)) this.broadcastRoom(room, { type: 'typing', data: { room, id: c.id, name: c.name, username: c.account.username ?? null, stop: true } });
    this.broadcastRoom(room, { type: 'chat', data: msg });
    return this.remember(c.id, cid, msg);
  }

  /**
   * Joueurs dont le pseudo commence par `q` (suggestions quand on tape « @ » dans le chat) : comptes actifs avec un personnage,
   * joueurs en ligne d'abord. Ne renvoie que ce qui s'affiche déjà dans le chat (pseudo, nom du personnage).
   */
  async searchUsers(accountId: string, raw: string) {
    const c = await this.characterOf(accountId);
    const q = raw.trim().replace(/^@/, '');
    if (!/^[\p{L}\p{N}_.-]{0,20}$/u.test(q)) return [];
    const rows = await this.prisma.account.findMany({
      where: { username: q ? { startsWith: q, mode: 'insensitive' } : { not: null }, deletedAt: null, guest: false, character: { isNot: null } },
      select: { username: true, character: { select: { id: true, name: true } } },
      orderBy: { username: 'asc' },
      take: 30,
    });
    const online = new Set([...this.clients.values()].map((x) => x.characterId).concat(this.freshPolled().map((p) => p.characterId)));
    return rows
      .filter((r) => r.character && r.username && r.character.id !== c.id)
      .map((r) => ({ id: r.character!.id, name: r.character!.name, username: r.username!, online: online.has(r.character!.id) }))
      .sort((a, b) => Number(b.online) - Number(a.online))
      .slice(0, 8);
  }

  /** Joueurs qui écrivent en ce moment dans un salon (sauf moi) ; purge les signaux expirés au passage. */
  private typingIn(room: string, me: string): { id: string; name: string; username: string | null }[] {
    const m = this.typingByRoom.get(room);
    if (!m) return [];
    const now = Date.now();
    for (const [k, v] of m) if (now - v.at > TYPING_MS) m.delete(k);
    if (m.size === 0) this.typingByRoom.delete(room);
    return [...m.values()].filter((v) => v.id !== me).map(({ id, name, username }) => ({ id, name, username }));
  }

  /**
   * « En train d'écrire » dans un salon (ville ou lieu) : diffusé aux autres joueurs du salon par le flux continu, et rendu
   * avec l'historique pour ceux qui n'ont pas de flux. Aucune écriture en base ; cadence bornée par joueur.
   */
  async typing(accountId: string, kind: RoomKind): Promise<{ ok: true }> {
    const c = await this.characterOf(accountId);
    if (c.account.guest) return { ok: true }; // un invité ne peut pas écrire dans le chat
    const room = LiveService.roomOf(kind, { city: c.city, place: c.locationId });
    let m = this.typingByRoom.get(room);
    if (!m) this.typingByRoom.set(room, (m = new Map()));
    const prev = m.get(c.id);
    const now = Date.now();
    if (prev && now - prev.at < TYPING_MIN_INTERVAL_MS) return { ok: true };
    const v = { id: c.id, name: c.name, username: c.account.username ?? null, at: now };
    m.set(c.id, v);
    for (const cl of this.clients.values())
      if (cl.characterId !== c.id && (LiveService.roomOf('city', cl) === room || LiveService.roomOf('place', cl) === room)) cl.out.next({ type: 'typing', data: { room, id: v.id, name: v.name, username: v.username } });
    return { ok: true };
  }


  // ───────────── Argent dans les conversations ─────────────

  /**
   * Trace d'un envoi d'argent dans la conversation privée des deux joueurs (posée par le serveur après un transfert réussi :
   * le client ne peut pas en fabriquer). Ne bloque jamais le transfert.
   */
  async moneyTrace(fromId: string, toId: string, amount: number): Promise<void> {
    try {
      const [a, b] = await Promise.all([
        this.prisma.character.findUnique({ where: { id: fromId }, select: { id: true, name: true } }),
        this.prisma.character.findUnique({ where: { id: toId }, select: { id: true, name: true } }),
      ]);
      if (!a || !b) return;
      const room = LiveService.dmRoom(a.id, b.id);
      const m = await this.prisma.chatMessage.create({ data: { room, characterId: a.id, text: '', moneyAmount: BigInt(amount) } });
      const msg = { id: m.id, room, from: a, to: b, text: '', at: m.createdAt.toISOString(), replyTo: null, money: String(amount) };
      this.toCharacters([a.id, b.id], { type: 'dm', data: msg });
    } catch (e) {
      this.logger.warn(`moneyTrace: ${(e as Error).message}`);
    }
  }

  private toCharacters(ids: string[], ev: MessageEvent): void {
    const set = new Set(ids);
    for (const cl of this.clients.values()) if (set.has(cl.characterId)) cl.out.next(ev);
  }

  // ───────────── Groupes de discussion ─────────────

  static groupRoom(id: string): string {
    return `group:${id}`;
  }

  /** Groupe tel que le voit un membre : nom, propriétaire, membres. */
  private async groupView(id: string) {
    const g = await this.prisma.chatGroup.findUnique({ where: { id }, include: { members: { orderBy: { joinedAt: 'asc' }, include: { character: { select: { id: true, name: true } } } } } });
    if (!g) throw new NotFoundException('unknown_group');
    return { id: g.id, name: g.name, ownerId: g.ownerId, createdAt: g.createdAt.toISOString(), members: g.members.map((x) => x.character) };
  }

  private async membership(groupId: string, characterId: string) {
    const m = await this.prisma.chatGroupMember.findUnique({ where: { groupId_characterId: { groupId, characterId } } });
    if (!m) throw new ForbiddenException('not_group_member');
  }

  private async groupMembers(id: string): Promise<string[]> {
    return (await this.prisma.chatGroupMember.findMany({ where: { groupId: id }, select: { characterId: true } })).map((m) => m.characterId);
  }

  /** Contrôles propres aux groupes : compte vérifié, pas muet, et le nom suit les règles de modération du chat. */
  private async groupName(c: Awaited<ReturnType<LiveService['characterOf']>>, raw: string): Promise<string> {
    const cfg = await this.settings.get('chat');
    if (c.account.guest) throw new ForbiddenException('account_required');
    if (c.mutedUntil && c.mutedUntil.getTime() > Date.now()) throw new ForbiddenException('chat_muted');
    if (Date.now() - c.account.createdAt.getTime() < cfg.minAccountAgeHours * 3_600_000) throw new ForbiddenException('chat_account_too_new');
    const v = checkMessage(raw, { maxLength: 40, blockedWords: cfg.blockedWords });
    if (!v.ok) throw new BadRequestException(v.code === 'chat_empty' ? 'group_name_invalid' : v.code);
    return v.text;
  }

  /** Mes groupes, avec leurs membres. */
  async myGroups(accountId: string) {
    const c = await this.characterOf(accountId);
    const rows = await this.prisma.chatGroupMember.findMany({
      where: { characterId: c.id },
      orderBy: { joinedAt: 'desc' },
      include: { group: { include: { members: { orderBy: { joinedAt: 'asc' }, include: { character: { select: { id: true, name: true } } } } } } },
    });
    return rows.map((r) => ({ id: r.group.id, name: r.group.name, ownerId: r.group.ownerId, createdAt: r.group.createdAt.toISOString(), members: r.group.members.map((x) => x.character) }));
  }

  /** Crée un groupe : le créateur en est le propriétaire ; les autres membres sont ajoutés tout de suite (ils le voient apparaître). */
  async createGroup(accountId: string, rawName: string, memberIds: string[]) {
    const c = await this.characterOf(accountId);
    const name = await this.groupName(c, rawName);
    const cfg = await this.settings.get('chat');
    const others = [...new Set(memberIds)].filter((id) => id !== c.id);
    if (others.length + 1 > cfg.groupMembersMax) throw new BadRequestException('group_full');
    if ((await this.prisma.chatGroupMember.count({ where: { characterId: c.id } })) >= cfg.groupsMax) throw new BadRequestException('too_many_groups');
    const found = await this.prisma.character.findMany({ where: { id: { in: others }, account: { deletedAt: null, guest: false, suspendedAt: null } }, select: { id: true } });
    if (found.length !== others.length) throw new NotFoundException('unknown_player');
    const g = await this.prisma.chatGroup.create({ data: { name, ownerId: c.id, members: { create: [c.id, ...others].map((characterId) => ({ characterId })) } } });
    const view = await this.groupView(g.id);
    this.toCharacters(others, { type: 'group_added', data: view });
    return view;
  }

  async groupHistory(accountId: string, groupId: string) {
    const c = await this.characterOf(accountId);
    await this.membership(groupId, c.id);
    const room = LiveService.groupRoom(groupId);
    const rows = await this.prisma.chatMessage.findMany({ where: { room, hidden: false }, orderBy: { createdAt: 'desc' }, take: (await this.settings.get('chat')).historySize, include: { character: { select: { id: true, name: true } } } });
    const q = await this.quotes(rows);
    return { room, group: await this.groupView(groupId), messages: rows.reverse().map((m) => this.shape(m, room, q)) };
  }

  async groupPost(accountId: string, groupId: string, raw: string, replyTo?: string, cid?: string) {
    const c = await this.characterOf(accountId);
    const again = this.replayed<object>(c.id, cid);
    if (again) return again;
    await this.membership(groupId, c.id);
    const text = await this.checkedText(c, raw);
    const room = LiveService.groupRoom(groupId);
    const quote = await this.replyTarget(room, replyTo);
    const m = await this.prisma.chatMessage.create({ data: { room, characterId: c.id, text, replyToId: quote?.id ?? null } });
    const msg = { id: m.id, room, groupId, from: { id: c.id, name: c.name }, text: m.text, at: m.createdAt.toISOString(), replyTo: quote, money: null };
    this.toCharacters(await this.groupMembers(groupId), { type: 'group', data: msg });
    return this.remember(c.id, cid, msg);
  }

  /** Ajoute un joueur au groupe (propriétaire seulement, dans la limite de membres du réglage). */
  async addGroupMember(accountId: string, groupId: string, targetId: string) {
    const c = await this.characterOf(accountId);
    const g = await this.prisma.chatGroup.findUnique({ where: { id: groupId }, select: { ownerId: true } });
    if (!g) throw new NotFoundException('unknown_group');
    if (g.ownerId !== c.id) throw new ForbiddenException('not_group_owner');
    if (c.account.guest) throw new ForbiddenException('account_required');
    const t = await this.prisma.character.findFirst({ where: { id: targetId, account: { deletedAt: null, guest: false, suspendedAt: null } }, select: { id: true } });
    if (!t) throw new NotFoundException('unknown_player');
    if (await this.prisma.chatGroupMember.findUnique({ where: { groupId_characterId: { groupId, characterId: t.id } } })) throw new BadRequestException('already_member');
    const cfg = await this.settings.get('chat');
    if ((await this.prisma.chatGroupMember.count({ where: { groupId } })) >= cfg.groupMembersMax) throw new BadRequestException('group_full');
    if ((await this.prisma.chatGroupMember.count({ where: { characterId: t.id } })) >= cfg.groupsMax) throw new BadRequestException('target_too_many_groups');
    await this.prisma.chatGroupMember.create({ data: { groupId, characterId: t.id } });
    const view = await this.groupView(groupId);
    this.toCharacters(view.members.map((m) => m.id), { type: 'group_added', data: view });
    return view;
  }

  /**
   * Quitter un groupe (`memberId` = soi) ou en retirer quelqu'un (propriétaire). Si le propriétaire part, le plus ancien membre le devient ;
   * le dernier à partir supprime le groupe et son historique.
   */
  async removeGroupMember(accountId: string, groupId: string, memberId: string) {
    const c = await this.characterOf(accountId);
    const g = await this.prisma.chatGroup.findUnique({ where: { id: groupId }, select: { ownerId: true } });
    if (!g) throw new NotFoundException('unknown_group');
    await this.membership(groupId, c.id);
    if (memberId !== c.id && g.ownerId !== c.id) throw new ForbiddenException('not_group_owner');
    await this.membership(groupId, memberId);
    await this.prisma.chatGroupMember.delete({ where: { groupId_characterId: { groupId, characterId: memberId } } });
    this.toCharacters([memberId], { type: 'group_removed', data: { id: groupId } });
    const left = await this.prisma.chatGroupMember.findMany({ where: { groupId }, orderBy: { joinedAt: 'asc' }, select: { characterId: true } });
    if (left.length === 0) {
      await this.prisma.$transaction([this.prisma.chatMessage.deleteMany({ where: { room: LiveService.groupRoom(groupId) } }), this.prisma.chatGroup.delete({ where: { id: groupId } })]);
      return { ok: true, deleted: true };
    }
    if (g.ownerId === memberId) await this.prisma.chatGroup.update({ where: { id: groupId }, data: { ownerId: left[0]!.characterId } });
    this.toCharacters(left.map((m) => m.characterId), { type: 'group_added', data: await this.groupView(groupId) });
    return { ok: true, deleted: false };
  }

  /** Signalement d'un joueur ou d'un message ; masquage automatique après plusieurs signalements distincts. */
  async report(accountId: string, input: { targetId: string; messageId?: string; reason: ReportReason }) {
    if (!REPORT_REASONS.includes(input.reason)) throw new BadRequestException('unknown_reason');
    const c = await this.characterOf(accountId);
    if (c.account.guest) throw new ForbiddenException('account_required');
    if (input.targetId === c.id) throw new BadRequestException('report_self');
    const target = await this.prisma.character.findUnique({ where: { id: input.targetId }, select: { id: true } });
    if (!target) throw new NotFoundException('unknown_player');
    if (input.messageId) {
      const msg = await this.prisma.chatMessage.findUnique({ where: { id: input.messageId }, select: { characterId: true } });
      if (!msg || msg.characterId !== input.targetId) throw new NotFoundException('unknown_message');
      const dup = await this.prisma.report.findUnique({ where: { reporterId_messageId: { reporterId: c.id, messageId: input.messageId } } });
      if (dup) return { reported: true, hidden: false };
    } else if (await this.prisma.report.findFirst({ where: { reporterId: c.id, targetId: input.targetId, messageId: null, status: 'OPEN' } })) {
      return { reported: true, hidden: false };
    }
    await this.prisma.report.create({ data: { reporterId: c.id, targetId: input.targetId, messageId: input.messageId ?? null, reason: input.reason } });
    let hidden = false;
    if (input.messageId) {
      const n = await this.prisma.report.count({ where: { messageId: input.messageId } });
      if (n >= (await this.settings.get('chat')).autoHideReports) {
        hidden = await this.hide(input.messageId);
      }
    }
    return { reported: true, hidden };
  }

  private async hide(messageId: string): Promise<boolean> {
    const r = await this.prisma.chatMessage.updateMany({ where: { id: messageId, hidden: false }, data: { hidden: true } });
    if (r.count > 0) this.broadcastAll({ type: 'chat_hidden', data: { id: messageId } });
    return r.count > 0;
  }

  // ───────────── Modération (admin) ─────────────

  async openReports() {
    const rows = await this.prisma.report.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        reporter: { select: { id: true, name: true } },
        target: { select: { id: true, name: true, mutedUntil: true } },
        message: { select: { id: true, text: true, room: true, hidden: true, createdAt: true } },
      },
    });
    const counts = await this.prisma.report.groupBy({ by: ['targetId'], where: { targetId: { in: rows.map((r) => r.targetId) } }, _count: { _all: true } });
    const total = new Map(counts.map((c) => [c.targetId, c._count._all]));
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      reporter: r.reporter,
      target: { ...r.target, mutedUntil: r.target.mutedUntil?.toISOString() ?? null, reportsTotal: total.get(r.targetId) ?? 0 },
      message: r.message ? { ...r.message, createdAt: r.message.createdAt.toISOString() } : null,
    }));
  }

  async resolve(adminAccountId: string, reportId: string, action: 'dismiss' | 'hide' | 'mute', muteHours: number, ip?: string) {
    const r = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!r || r.status !== 'OPEN') throw new NotFoundException('unknown_report');
    if (action !== 'dismiss' && r.messageId) await this.hide(r.messageId);
    if (action === 'mute') {
      await this.prisma.character.update({ where: { id: r.targetId }, data: { mutedUntil: new Date(Date.now() + muteHours * 3_600_000) } });
    }
    // Un même message signalé par plusieurs joueurs : tous ses signalements sont traités ensemble
    const where = r.messageId ? { messageId: r.messageId, status: 'OPEN' as const } : { id: r.id };
    await this.prisma.report.updateMany({ where, data: { status: action === 'dismiss' ? 'DISMISSED' : 'ACTIONED', resolvedAt: new Date(), resolvedBy: adminAccountId } });
    await this.audit.log(`report.${action}`, { actorId: adminAccountId, target: r.targetId, meta: { report: r.id, muteHours: action === 'mute' ? muteHours : 0 }, ip });
    return { ok: true };
  }
}
