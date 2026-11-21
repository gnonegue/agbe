/**
 * Mises à jour de l'appli (PWA). Le service worker sert la version qu'il a en cache : après un déploiement, une page
 * ouverte (ou même une première ouverture du jour) peut donc tourner sur l'ancienne version jusqu'à un rechargement.
 *
 * Chaque build porte un identifiant (`__AGBE_BUILD__`) et publie `/version.json` (jamais mis en cache). On compare
 * régulièrement (toutes les minutes, au retour sur l'appli, au retour du réseau). Quand le serveur a une version plus
 * récente, le nouveau service worker la télécharge EN ENTIER (≈ 1 Mo : une minute ou plus en 3G) avant de prendre la main.
 *
 * Règle clé : on ne propose « Mettre à jour » qu'une fois la nouvelle version réellement installée. Recharger plus tôt
 * ferait servir l'ancienne version par l'ancien service worker, et le bandeau reviendrait en boucle.
 * - hors partie (accueil, connexion…), la nouvelle version est chargée toute seule dès qu'elle est prête ;
 * - en partie ou dans l'administration, le bandeau « Mettre à jour » s'affiche sans interrompre le joueur, et on recharge
 *   tout seul quand l'appli passe en arrière-plan.
 * Filet de sécurité : si après un rechargement demandé la page est toujours en retard (installation bloquée, déploiement
 * incomplet), on désinstalle le service worker et on vide ses caches, puis on recharge depuis le réseau (une seule fois).
 */
declare const __AGBE_BUILD__: string;

/** `downloading` : nouvelle version en téléchargement ; `ready` : installée, prête au rechargement ; `applying` : rechargement en cours. */
export type UpdateState = 'idle' | 'downloading' | 'ready' | 'applying';
type Listener = (s: UpdateState) => void;
const listeners = new Set<Listener>();
let status: UpdateState = 'idle';
/** Écrans où un rechargement surprise ferait perdre quelque chose (partie, administration). */
let holds = 0;
let reloading = false;

export const BUILD_ID: string = typeof __AGBE_BUILD__ === 'string' ? __AGBE_BUILD__ : 'dev';

/** Version visée par le dernier rechargement demandé (survit au rechargement, pas à la fermeture de l'onglet). */
const ASKED_KEY = 'agbe-update-asked';
/** Remise à zéro du service worker déjà tentée pour cette version (une seule fois : pas de boucle). */
const HARD_KEY = 'agbe-update-hard';
/** Rechargement automatique déjà tenté pour cette version. */
const AUTO_KEY = 'agbe-update-target';

const store = {
  get(k: string): string | null {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* stockage indisponible */
    }
  },
};

function setStatus(s: UpdateState) {
  if (status === s) return;
  status = s;
  listeners.forEach((fn) => fn(s));
}

export function onUpdateState(fn: Listener): () => void {
  listeners.add(fn);
  fn(status);
  return () => void listeners.delete(fn);
}

/** À appeler par un écran où il ne faut pas recharger sans prévenir (renvoie la fonction de libération). */
export function holdAutoReload(): () => void {
  holds++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds--;
  };
}

/** Un champ en cours de saisie (connexion, inscription…) : on ne recharge pas sous les doigts du joueur. */
function typing(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

let latest: string | null = null;

function sw(): ServiceWorkerContainer | null {
  return 'serviceWorker' in navigator ? navigator.serviceWorker : null;
}

/** Attend qu'un service worker en cours d'installation soit actif (true) ou abandonné (false), au plus `ms`. */
function settle(worker: ServiceWorker, ms: number): Promise<boolean> {
  return new Promise((done) => {
    if (worker.state === 'activated') return done(true);
    if (worker.state === 'redundant') return done(false);
    const timer = window.setTimeout(() => {
      worker.removeEventListener('statechange', on);
      done(worker.state === 'activated');
    }, ms);
    const on = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        window.clearTimeout(timer);
        worker.removeEventListener('statechange', on);
        done(worker.state === 'activated');
      }
    };
    worker.addEventListener('statechange', on);
  });
}

/** Dernier recours : retire le service worker et ses caches, la page suivante vient directement du serveur. */
async function hardReset(): Promise<void> {
  try {
    const regs = (await sw()?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('workbox-precache') || k.startsWith('agbe-')).map((k) => caches.delete(k)));
    }
  } catch {
    /* on recharge quand même */
  }
  window.location.reload();
}

/**
 * Recharge sur la nouvelle version. Si elle est encore en téléchargement, on attend la fin (jusqu'à 2 min en 3G) au lieu
 * de recharger sur l'ancienne. La version visée est notée : si la page rouvre encore en retard, `check` fera la remise à zéro.
 */
export async function reloadNow(): Promise<void> {
  if (reloading) return;
  reloading = true;
  setStatus('applying');
  if (latest) store.set(ASKED_KEY, latest);
  try {
    const reg = await sw()?.getRegistration();
    await reg?.update().catch(() => undefined);
    const incoming = reg?.installing ?? reg?.waiting ?? null;
    if (incoming) {
      incoming.postMessage({ type: 'SKIP_WAITING' });
      await settle(incoming, 120_000);
    }
  } catch {
    /* rien : on recharge quand même */
  }
  window.location.reload();
}

/** Nouvelle version installée : rechargement direct hors partie, sinon bandeau. */
function newVersionReady() {
  const target = latest ?? 'sw';
  if (holds === 0 && !typing() && store.get(AUTO_KEY) !== target) {
    store.set(AUTO_KEY, target);
    void reloadNow();
  } else setStatus('ready');
}

async function fetchLatest(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null; // hors ligne, ou ancien serveur sans version.json
  }
}

export function watchUpdates(): void {
  if (import.meta.env.DEV) return;
  const container = sw();
  // Le premier changement de contrôleur d'une première visite n'est pas une mise à jour
  let controlled = !!container?.controller;
  container?.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      if (latest && latest !== BUILD_ID) newVersionReady();
      return;
    }
    newVersionReady();
  });

  let busy = false;
  const check = async () => {
    if (busy || reloading) return;
    busy = true;
    try {
      const build = await fetchLatest();
      if (!build || build === BUILD_ID) {
        container?.getRegistration().then((r) => r?.update()).catch(() => undefined);
        return;
      }
      latest = build;
      // Rechargement déjà demandé pour cette version et la page est toujours ancienne : le service worker est bloqué
      if (store.get(ASKED_KEY) === build && store.get(HARD_KEY) !== build) {
        store.set(HARD_KEY, build);
        void hardReset();
        return;
      }
      if (!container) return newVersionReady();
      if (status === 'ready' || status === 'applying') return;
      const reg = await container.getRegistration();
      if (!reg) return newVersionReady();
      await reg.update().catch(() => undefined);
      const incoming = reg.installing ?? reg.waiting;
      if (!incoming) {
        // Rien à installer alors que le serveur annonce une autre version : déploiement en cours (fichiers pas encore
        // tous envoyés) ou service worker déjà à jour mais page ancienne. Dans le second cas, recharger suffit.
        if (reg.active && container.controller && reg.active !== container.controller) newVersionReady();
        return;
      }
      setStatus('downloading');
      incoming.postMessage({ type: 'SKIP_WAITING' });
      // `controllerchange` annoncera la fin ; si l'installation échoue (fichier manquant pendant un déploiement), on
      // revient à l'état normal et on réessaiera à la prochaine vérification.
      const ok = await settle(incoming, 300_000);
      if (!ok && status === 'downloading') setStatus('idle');
    } finally {
      busy = false;
    }
  };

  window.setInterval(() => void check(), 60_000);
  window.addEventListener('online', () => void check());
  window.addEventListener('focus', () => void check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
    else if (status === 'ready') void reloadNow(); // passage en arrière-plan : on recharge sans que le joueur le voie
  });
  void check();
}
