// Préférences locales NON sensibles (langue, qualité 3D, journal de jeu) uniquement. Jamais de jeton ici.
import type { Locale } from '../api/types';

export type Quality = 'low' | 'medium' | 'high';
const LANG_KEY = 'agbe.lang';
const QUALITY_KEY = 'agbe.quality';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible (navigation privée…) : on ignore */
  }
}

export function getSavedLang(): Locale | null {
  const v = read(LANG_KEY);
  return v === 'fr' || v === 'en' ? v : null;
}
export function saveLang(l: Locale): void {
  write(LANG_KEY, l);
}
export function getSavedQuality(): Quality | null {
  const v = read(QUALITY_KEY);
  return v === 'low' || v === 'medium' || v === 'high' ? v : null;
}
export function saveQuality(q: Quality): void {
  write(QUALITY_KEY, q);
}
/** Personnages réalistes (par défaut) ou classiques (plus légers, style dessin animé). */
const REAL_PEOPLE_KEY = 'agbe.realPeople';
export function getSavedRealPeople(): boolean {
  return read(REAL_PEOPLE_KEY) !== '0';
}
export function saveRealPeople(on: boolean): void {
  write(REAL_PEOPLE_KEY, on ? '1' : '0');
}

// Simple indicateur NON sensible « une session a existé sur cet appareil » : évite un /auth/refresh inutile
// au démarrage pour un visiteur jamais connecté. Ce n'est pas un jeton.
const HAD_SESSION_KEY = 'agbe.hadSession';
export function hadSession(): boolean {
  return read(HAD_SESSION_KEY) === '1';
}
export function setHadSession(v: boolean): void {
  if (v) write(HAD_SESSION_KEY, '1');
  else {
    try {
      window.localStorage.removeItem(HAD_SESSION_KEY);
    } catch {
      /* ignoré */
    }
  }
}

// Journal « Ma vie » : récit local des actions réussies (aucune donnée de compte, seulement du texte de jeu).
export interface JournalEntry {
  id: number;
  day: number;
  time: string;
  text: string;
}
const JOURNAL_MAX = 60;
const journalKey = (characterId: string) => `agbe.journal.${characterId}`;
export function loadJournal(characterId: string): JournalEntry[] {
  try {
    const v: unknown = JSON.parse(read(journalKey(characterId)) ?? '[]');
    if (!Array.isArray(v)) return [];
    return v
      .filter((e): e is JournalEntry => !!e && typeof e.id === 'number' && typeof e.day === 'number' && typeof e.time === 'string' && typeof e.text === 'string')
      .slice(0, JOURNAL_MAX);
  } catch {
    return [];
  }
}
export function saveJournal(characterId: string, entries: JournalEntry[]): void {
  write(journalKey(characterId), JSON.stringify(entries.slice(0, JOURNAL_MAX)));
}

// Contacts épinglés dans le chat privé : identifiants de personnage gardés en haut de la liste, sur cet appareil.
const pinnedDmsKey = (characterId: string) => `agbe.pinnedDms.${characterId}`;
export function loadPinnedDms(characterId: string): string[] {
  try {
    const v: unknown = JSON.parse(read(pinnedDmsKey(characterId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function togglePinnedDm(characterId: string, peerId: string): string[] {
  const cur = loadPinnedDms(characterId);
  const next = cur.includes(peerId) ? cur.filter((x) => x !== peerId) : [...cur, peerId];
  write(pinnedDmsKey(characterId), JSON.stringify(next));
  return next;
}

// Messages masqués « pour moi » dans le chat : identifiants gardés sur cet appareil (les autres joueurs les voient toujours).
const hiddenMsgsKey = (characterId: string) => `agbe.hiddenMsgs.${characterId}`;
export function loadHiddenMsgs(characterId: string): string[] {
  try {
    const v: unknown = JSON.parse(read(hiddenMsgsKey(characterId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function hideMsg(characterId: string, msgId: string): string[] {
  const next = [...new Set([...loadHiddenMsgs(characterId), msgId])].slice(-500);
  write(hiddenMsgsKey(characterId), JSON.stringify(next));
  return next;
}
