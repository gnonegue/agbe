// Visite guidée : simple indicateur NON sensible « déjà vue sur cet appareil ». Jamais de jeton ici.
const KEY = 'agbe.tourDone';
export const TOUR_EVENT = 'agbe:tour';

export function tourDone(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function setTourDone(v: boolean): void {
  try {
    if (v) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : la visite se relancera simplement */
  }
}
/** Relance la visite (bouton des Réglages). */
export function replayTour(): void {
  window.dispatchEvent(new Event(TOUR_EVENT));
}
