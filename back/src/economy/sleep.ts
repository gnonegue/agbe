export interface SleepRules {
  /** Heure de jeu à partir de laquelle on peut se coucher (ex. 20). */
  fromHour: number;
  /** Heure de réveil visée (ex. 6) ; on peut aussi se coucher en pleine nuit, avant elle. */
  wakeHour: number;
  minGameHours: number;
  maxGameHours: number;
}

/**
 * Durée de la nuit (heures de jeu) si l'on se couche à `minuteOfDay`, ou null hors des heures de coucher.
 * On dort jusqu'à l'heure de réveil, dans la limite [min, max] : couché à 21 h 30 → 8 h, à 23 h → 7 h, à 2 h → 6 h.
 */
export function sleepGameHours(minuteOfDay: number, r: SleepRules): number | null {
  const from = r.fromHour * 60;
  const wake = r.wakeHour * 60;
  const night = from > wake ? minuteOfDay >= from || minuteOfDay < wake : minuteOfDay >= from && minuteOfDay < wake;
  if (!night) return null;
  const untilWake = (((wake - minuteOfDay) % 1440) + 1440) % 1440 / 60;
  return Math.min(r.maxGameHours, Math.max(r.minGameHours, untilWake));
}
