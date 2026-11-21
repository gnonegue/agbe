/**
 * Météo du jeu : une seule source pour la ville 3D (pluie, sol mouillé) et le téléphone (accueil, appli Météo).
 * Elle dépend du temps de jeu (jour, saison, heure), donc elle suit le jour et la nuit du jeu et ne change pas au rechargement.
 * Le temps est découpé en créneaux de 3 h de jeu ; chacun est pluvieux ou non selon un tirage fixe et la saison.
 * Après la pluie, le sol reste mouillé (flaques, écoulements) et sèche peu à peu pendant `DRY_MIN`.
 */
export type Season = 'harmattan' | 'rains' | 'dry' | 'smallRains';

/** Durée d'un créneau météo (minutes de jeu). */
export const SLOT_MIN = 180;
/** Temps de séchage du sol après la dernière pluie : 18 h de jeu (soit trois quarts de journée). */
export const DRY_MIN = 18 * 60;

/** Saison selon le mois de jeu (mois de 30 jours, 0 = janvier). */
export function seasonOfDay(day: number): Season {
  const m = Math.floor(day / 30) % 12;
  return m === 11 || m <= 1 ? 'harmattan' : m <= 6 ? 'rains' : m === 7 ? 'dry' : 'smallRains';
}

/** Probabilité qu'un créneau soit pluvieux, selon la saison. */
const CHANCE: Record<Season, number> = { harmattan: 0.03, rains: 0.3, dry: 0.08, smallRains: 0.22 };

function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Pluie du créneau : 0 = sec, de 0,5 (bruine) à 1 (averse). */
function slotRain(slot: number): number {
  const day = Math.floor((slot * SLOT_MIN) / 1440);
  if (hash(slot) >= CHANCE[seasonOfDay(day)]) return 0;
  return 0.5 + 0.5 * hash(slot + 7919);
}

/** Intensité de pluie à cet instant (minutes de jeu depuis le jour 0). */
export function rainAt(total: number): number {
  return slotRain(Math.floor(total / SLOT_MIN));
}

/** Humidité du sol : 1 pendant la pluie, puis décroît linéairement jusqu'à 0 en `DRY_MIN`. */
export function wetnessAt(total: number): number {
  const cur = Math.floor(total / SLOT_MIN);
  let w = 0;
  for (let s = cur; s >= cur - Math.ceil(DRY_MIN / SLOT_MIN) - 1; s--) {
    if (s < 0 || slotRain(s) === 0) continue;
    const since = Math.max(0, total - (s + 1) * SLOT_MIN);
    w = Math.max(w, 1 - since / DRY_MIN);
  }
  return Math.max(0, w);
}

/** Pluie prévue dans la journée (au moins un créneau pluvieux). */
export function dayHasRain(day: number): boolean {
  for (let k = 0; k < 1440 / SLOT_MIN; k++) if (slotRain(Math.floor((day * 1440) / SLOT_MIN) + k) > 0) return true;
  return false;
}

/** Prochain changement : la pluie s'arrête (si elle tombe) ou commence, dans `inMin` minutes (null au-delà de 3 jours). */
export function nextRainChange(total: number): { raining: boolean; inMin: number } | null {
  const cur = Math.floor(total / SLOT_MIN);
  const raining = slotRain(cur) > 0;
  for (let k = 1; k <= 24; k++) if ((slotRain(cur + k) > 0) !== raining) return { raining, inMin: (cur + k) * SLOT_MIN - total };
  return null;
}

/** Jour : de 6 h à 18 h 30 (minute de la journée). */
export function isNight(minuteOfDay: number): boolean {
  return minuteOfDay < 360 || minuteOfDay >= 1110;
}

/** Temps de jeu total (minutes) d'un instant `gameTime` du serveur. */
export function totalOf(t: { day: number; hour: number; minute: number; totalMinutes?: number }): number {
  return t.totalMinutes && t.totalMinutes > 0 ? t.totalMinutes : t.day * 1440 + t.hour * 60 + t.minute;
}

/** Ciel de Lomé maintenant, pour le téléphone : mêmes données que la ville 3D. */
export function weatherNow(total: number) {
  const day = Math.floor(total / 1440);
  const minute = ((total % 1440) + 1440) % 1440;
  const season = seasonOfDay(day);
  const rain = rainAt(total);
  const night = isNight(minute);
  const h = Math.floor(hash(day + 31337) * 1000);
  const base = { harmattan: 31, rains: 29, dry: 27, smallRains: 29 }[season];
  const max = base + (h % 3) - (dayHasRain(day) ? 2 : 0);
  // Température : fraîche la nuit, maximale vers 14 h, plus fraîche sous la pluie
  const swing = Math.cos(((minute - 14 * 60) / 1440) * 2 * Math.PI);
  const temp = Math.round(max - 3 - (1 - swing) * 3 - (rain > 0 ? 2 : 0));
  const sky = rain > 0 ? (rain > 0.85 ? '⛈️' : '🌧️') : night ? '🌙' : season === 'harmattan' ? '🌫️' : h % 3 === 0 ? '⛅' : '☀️';
  return { season, rain, night, wet: wetnessAt(total), temp, max, min: max - 6, sky, change: nextRainChange(total) };
}
