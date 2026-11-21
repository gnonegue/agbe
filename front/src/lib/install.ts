import { useEffect, useState } from 'react';

// Installation de la PWA. Chrome, Edge et Android émettent `beforeinstallprompt` tôt, souvent avant l'affichage
// de la page d'accueil : on le capte dès le chargement du module (importé par main.tsx) et on le garde.
// Safari (iPhone, iPad) n'a pas cet événement : l'installation passe par « Partager → Sur l'écran d'accueil ».
// Sans l'événement (Firefox, page en HTTP, serveur de dev sans service worker…), on explique la voie du menu du navigateur.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'prompt' | 'ios' | 'manual' | null;

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const iosSafari = () => {
  const ua = navigator.userAgent;
  // iPadOS se présente comme un Mac : on le reconnaît à l'écran tactile
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  deferred = null;
  notify();
});

const mode = (): InstallMode => {
  if (installed || standalone()) return null;
  if (deferred) return 'prompt';
  return iosSafari() ? 'ios' : 'manual';
};

// Le service worker s'enregistre après le chargement : un clic très rapide peut précéder l'événement.
// On l'attend un court instant, sans dépasser la durée pendant laquelle le navigateur accepte encore le clic.
const WAIT_MS = 3000;
const nextPrompt = () =>
  new Promise<InstallPromptEvent | null>((resolve) => {
    const timer = setTimeout(() => {
      listeners.delete(l);
      resolve(null);
    }, WAIT_MS);
    const l = () => {
      if (!deferred) return;
      clearTimeout(timer);
      listeners.delete(l);
      resolve(deferred);
    };
    listeners.add(l);
  });

/**
 * Ouvre la fenêtre d'installation du navigateur (l'événement ne sert qu'une fois).
 * Renvoie `false` si le navigateur ne la propose pas : il faut alors passer par son menu.
 */
export async function promptInstall(): Promise<boolean> {
  const e = deferred ?? (await nextPrompt());
  if (!e) return false;
  deferred = null;
  await e.prompt();
  if ((await e.userChoice).outcome === 'accepted') installed = true;
  notify();
  return true;
}

/** Comment installer l'application ici : fenêtre du navigateur, mode d'emploi (iOS ou menu du navigateur), ou rien si elle est déjà installée. */
export function useInstall(): InstallMode {
  const [m, setM] = useState(mode);
  useEffect(() => {
    const l = () => setM(mode());
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return m;
}
