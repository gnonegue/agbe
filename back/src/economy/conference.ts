/** Conférences publiques : calendrier (un jour de jeu sur `everyDays`) et sujet du jour. Fonctions pures. */

export interface ConferenceSchedule {
  startHour: number;
  hours: number;
  /** Une conférence tous les `everyDays` jours de jeu, à partir du jour `offsetDay`. */
  everyDays: number;
  offsetDay: number;
}

/** Rang de la conférence de ce jour (0, 1, 2…), ou null s'il n'y en a pas ce jour-là. */
export function conferenceIndex(day: number, s: ConferenceSchedule): number | null {
  const d = day - s.offsetDay;
  if (d < 0 || d % s.everyDays !== 0) return null;
  return d / s.everyDays;
}

/** Les `n` prochaines conférences (jour et rang), celle du jour comprise tant qu'elle n'est pas finie. */
export function nextConferences(day: number, minuteOfDay: number, s: ConferenceSchedule, n: number): { day: number; index: number }[] {
  const out: { day: number; index: number }[] = [];
  const endMinute = (s.startHour + s.hours) * 60;
  let d = minuteOfDay >= endMinute ? day + 1 : day;
  d = Math.max(d, s.offsetDay);
  const r = (d - s.offsetDay) % s.everyDays;
  if (r !== 0) d += s.everyDays - r;
  while (out.length < n) {
    out.push({ day: d, index: (d - s.offsetDay) / s.everyDays });
    d += s.everyDays;
  }
  return out;
}
