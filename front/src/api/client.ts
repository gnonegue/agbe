// Client HTTP d'AGBE.
// Sécurité :
//  - le jeton d'accès vit UNIQUEMENT dans cette variable de module (jamais localStorage/sessionStorage/cookie JS) ;
//  - le jeton de rafraîchissement est un cookie httpOnly posé par le serveur (invisible ici) ;
//  - /auth/* reçoit l'en-tête anti-CSRF X-AGBE-CSRF ;
//  - sur 401 d'une route protégée : un seul /auth/refresh (mutualisé dans l'onglet, sérialisé entre onglets
//    via navigator.locks), puis on rejoue la requête une fois ;
//  - un échec transitoire du refresh (429, 5xx, réseau) ne déconnecte PAS l'utilisateur.

import type { TokenResponse } from './types';
import { setHadSession } from '../lib/prefs';

const BASE = '/api';
let accessToken: string | null = null;
/** Résultat d'un rafraîchissement : succès, session invalide (401/403) ou échec transitoire (429, 5xx, réseau). */
export type RefreshResult = 'ok' | 'invalid' | 'transient';
let refreshInFlight: Promise<RefreshResult> | null = null;
let onAuthLost: (() => void) | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function hasAccessToken(): boolean {
  return accessToken !== null;
}
export function setAuthLostHandler(fn: (() => void) | null): void {
  onAuthLost = fn;
}

/** Clé d'idempotence : 32 caractères hexadécimaux (UUID sans tirets), conforme à [A-Za-z0-9_-]{16,64}. */
export function idempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Normalise le champ `error` de l'API (chaîne ou tableau de codes) en un code unique. */
function errorCode(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error: unknown }).error;
    const first = Array.isArray(e) ? e[0] : e;
    if (typeof first === 'string' && /^[a-z0-9_]{2,64}$/.test(first)) return first;
  }
  if (status === 429) return 'too_many_requests';
  if (status === 401) return 'unauthorized';
  if (status >= 500) return 'server_error';
  return 'request_failed';
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Route protégée : envoie le Bearer et gère le 401 → refresh → rejeu. */
  auth?: boolean;
  /** Ajoute un en-tête Idempotency-Key (actions payantes). */
  idempotent?: boolean;
  /** Clé fournie par l'appelant (ex. conservée entre deux tentatives d'un même transfert). */
  idemKey?: string;
  signal?: AbortSignal;
  /** Corps binaire (image) envoyé tel quel, avec son type MIME. */
  blob?: Blob;
}

/** Délai maximal d'une requête ordinaire (le serveur répond en général en moins d'une seconde). */
const REQUEST_TIMEOUT_MS = 25_000;

async function rawFetch(path: string, opts: Options, idemKey: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.blob) headers['Content-Type'] = opts.blob.type;
  else if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (path.startsWith('/auth/') || path === '/init') headers['X-AGBE-CSRF'] = '1';
  if (opts.auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  // Sans signal de l'appelant (flux SSE, recherche annulable…), une requête ne peut pas rester pendante indéfiniment :
  // sur un réseau mobile qui décroche, le jeu resterait « occupé » et tous les boutons grisés. On abandonne au bout
  // d'un délai, ce qui remonte une erreur réseau et libère l'interface.
  let signal = opts.signal ?? null;
  let timer: number | undefined;
  if (!signal) {
    const ctrl = new AbortController();
    timer = window.setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), opts.blob ? 90_000 : REQUEST_TIMEOUT_MS);
    signal = ctrl.signal;
  }
  const res = fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.blob ?? (opts.body !== undefined ? JSON.stringify(opts.body) : null),
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'strict-origin-when-cross-origin',
    signal,
  });
  if (timer === undefined) return res;
  // Le délai couvre aussi la lecture du corps : on ne l'arrête qu'une fois la réponse entièrement lue
  return res.then(
    async (r) => {
      try {
        const body = r.status === 204 || r.status === 304 ? null : await r.blob();
        return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
      } finally {
        window.clearTimeout(timer);
      }
    },
    (e: unknown) => {
      window.clearTimeout(timer);
      throw e;
    },
  );
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (!res.ok) throw new ApiError(res.status, errorCode(body, res.status));
  return body as T;
}

// Après un refus 429, on attend avant de redemander : sinon chaque requête du jeu relance le refresh et entretient le blocage.
let refreshPausedUntil = 0;

async function doRefresh(): Promise<RefreshResult> {
  if (Date.now() < refreshPausedUntil) return 'transient';
  let res: Response;
  try {
    res = await rawFetch('/auth/refresh', { method: 'POST' }, null);
  } catch {
    return 'transient';
  }
  if (res.status === 401 || res.status === 403) {
    accessToken = null;
    return 'invalid';
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after'));
    refreshPausedUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120) : 30) * 1000;
    return 'transient';
  }
  if (!res.ok) return 'transient';
  try {
    const data = (await res.json()) as TokenResponse;
    if (typeof data?.accessToken !== 'string') return 'transient';
    accessToken = data.accessToken;
    return 'ok';
  } catch {
    return 'transient';
  }
}

/**
 * Un seul rafraîchissement à la fois : les requêtes concurrentes de l'onglet attendent la même promesse,
 * et navigator.locks sérialise les onglets (le jeton de rafraîchissement tourne à chaque appel).
 */
export function refreshSession(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    const p: Promise<RefreshResult> =
      locks && typeof locks.request === 'function'
        ? locks.request('agbe-refresh', () => doRefresh()).then(
            (r: unknown) => (r === 'ok' || r === 'invalid' ? r : 'transient') as RefreshResult,
            () => 'transient' as const,
          )
        : doRefresh();
    refreshInFlight = p.finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Après un échec du refresh : session perdue (retour connexion) ou panne passagère (on reste connecté). */
function refreshFailure(r: Exclude<RefreshResult, 'ok'>): never {
  if (r === 'invalid') {
    accessToken = null;
    setHadSession(false);
    onAuthLost?.();
    throw new ApiError(401, 'session_expired');
  }
  throw new ApiError(503, 'network_error');
}

/** Attentes avant les nouveaux essais d'une requête sans risque (lecture, ou action protégée par une clé d'idempotence). */
const RETRY_WAITS_MS = [1200, 3000];
/** Réponses d'un serveur momentanément indisponible (application qui redémarre ou se réveille chez l'hébergeur, proxy saturé). */
const UNAVAILABLE = new Set([502, 503, 504, 508]);

/**
 * Envoi avec nouveaux essais automatiques quand c'est sans danger : une lecture (GET) après une coupure ou un serveur
 * indisponible ; une action portant une clé d'idempotence seulement si l'hébergeur l'a refusée sans la transmettre.
 * Sur un réseau 3G qui décroche une seconde, ou pendant le réveil de l'API chez l'hébergeur, le joueur ne voit ainsi
 * pas d'erreur pour un incident de quelques secondes.
 */
async function fetchWithRetry(path: string, opts: Options, idemKey: string | null): Promise<Response> {
  const read = (opts.method ?? 'GET') === 'GET';
  // Une action (POST…) n'est rejouée que si l'hébergeur l'a refusée AVANT l'application (503, 508) : après une coupure
  // réseau ou un 502/504, elle a peut-être déjà été exécutée, et toutes les routes ne lisent pas la clé d'idempotence
  // (remplir le congélateur, travailler…) : la rejouer pourrait débiter deux fois.
  const retryable = (status: number) => (read ? UNAVAILABLE.has(status) : idemKey !== null && (status === 503 || status === 508));
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_WAITS_MS.length || !!opts.signal?.aborted;
    try {
      const res = await rawFetch(path, opts, idemKey);
      if (last || !retryable(res.status)) return res;
    } catch (e) {
      if ((e as Error).name === 'AbortError' && opts.signal?.aborted) throw e;
      if (last || !read) throw e;
    }
    await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt]));
  }
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  // La même clé est réutilisée en cas de rejeu après refresh : pas de double débit possible.
  const idemKey = opts.idemKey && /^[A-Za-z0-9_-]{16,64}$/.test(opts.idemKey) ? opts.idemKey : opts.idempotent ? idempotencyKey() : null;
  let res: Response;
  try {
    res = await fetchWithRetry(path, opts, idemKey);
  } catch (e) {
    if ((e as Error).name === 'AbortError' && opts.signal?.aborted) throw e;
    throw new ApiError(0, 'network_error');
  }
  if (res.status === 401 && opts.auth) {
    const r = await refreshSession();
    if (r !== 'ok') refreshFailure(r);
    try {
      res = await fetchWithRetry(path, opts, idemKey);
    } catch {
      throw new ApiError(0, 'network_error');
    }
    if (res.status === 401) {
      accessToken = null;
      onAuthLost?.();
      throw new ApiError(401, 'session_expired');
    }
  }
  return parse<T>(res);
}

/** Télécharge un fichier binaire protégé (image à modérer) en réutilisant l'authentification. */
export async function apiBlob(path: string): Promise<Blob> {
  let res = await rawFetch(path, { auth: true }, null);
  if (res.status === 401) {
    if ((await refreshSession()) !== 'ok') throw new ApiError(401, 'session_expired');
    res = await rawFetch(path, { auth: true }, null);
  }
  if (!res.ok) throw new ApiError(res.status, errorCode(undefined, res.status));
  return res.blob();
}

/** Événement d'un flux serveur (SSE). */
export interface StreamEvent {
  type: string;
  data: unknown;
}

/**
 * Flux d'événements serveur authentifié (SSE lu par fetch : EventSource ne sait pas envoyer le Bearer).
 * Se reconnecte seul avec un délai croissant ; un 401 déclenche un refresh puis une reconnexion.
 * Renvoie une fonction d'arrêt.
 */
export function openStream(path: string, onEvent: (e: StreamEvent) => void, onStatus?: (online: boolean) => void): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  let delay = 1000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function once(): Promise<void> {
    ctrl = new AbortController();
    const res = await rawFetch(path, { auth: true, signal: ctrl.signal }, null);
    if (res.status === 401) {
      const r = await refreshSession();
      if (r === 'invalid') {
        stopped = true;
        refreshFailure(r);
      }
      return;
    }
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    onStatus?.(true);
    delay = 1000;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let type = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length === 0) continue;
        try {
          onEvent({ type, data: JSON.parse(data.join('\n')) });
        } catch {
          // événement illisible : ignoré
        }
      }
      if (buf.length > 1_000_000) throw new Error('stream overflow');
    }
  }

  void (async () => {
    while (!stopped) {
      try {
        await once();
      } catch {
        // coupure réseau ou serveur redémarré : on réessaie
      }
      onStatus?.(false);
      if (stopped) break;
      await sleep(delay);
      delay = Math.min(delay * 2, 30_000);
    }
  })();

  return () => {
    stopped = true;
    ctrl?.abort();
  };
}
