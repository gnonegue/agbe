// Horloge accélérée commune à tous les joueurs.
// Par défaut : 1 journée de jeu = 3 600 secondes réelles (1 heure de jeu ≈ 2 min 30).

export interface ClockConfig {
  /** Instant réel (ms epoch) correspondant au jour 0, 00:00 du jeu. */
  epochRealMs: number;
  /** Durée réelle d'une journée de jeu, en secondes. */
  secondsPerGameDay: number;
}

export interface GameTime {
  /** Minutes de jeu écoulées depuis l'origine. */
  totalMinutes: number;
  day: number;
  hour: number;
  minute: number;
  /** Mois de 30 jours de jeu. */
  month: number;
  dayOfMonth: number;
}

export const GAME_MINUTES_PER_DAY = 24 * 60;
export const GAME_DAYS_PER_MONTH = 30;

export function gameMinutesBetween(cfg: ClockConfig, fromMs: number, toMs: number): number {
  if (cfg.secondsPerGameDay <= 0) throw new RangeError('secondsPerGameDay must be > 0');
  const realSeconds = (toMs - fromMs) / 1000;
  return (realSeconds * GAME_MINUTES_PER_DAY) / cfg.secondsPerGameDay;
}

export function gameTimeAt(cfg: ClockConfig, nowMs: number): GameTime {
  const totalMinutes = Math.max(0, Math.floor(gameMinutesBetween(cfg, cfg.epochRealMs, nowMs)));
  const day = Math.floor(totalMinutes / GAME_MINUTES_PER_DAY);
  const minuteOfDay = totalMinutes % GAME_MINUTES_PER_DAY;
  return {
    totalMinutes,
    day,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    month: Math.floor(day / GAME_DAYS_PER_MONTH),
    dayOfMonth: (day % GAME_DAYS_PER_MONTH) + 1,
  };
}

/** Nombre d'heures de jeu écoulées entre deux instants réels. */
export function gameHoursBetween(cfg: ClockConfig, fromMs: number, toMs: number): number {
  return gameMinutesBetween(cfg, fromMs, toMs) / 60;
}

/** Instant réel (ms) correspondant à `gameHours` heures de jeu après `fromMs`. */
export function realMsAfterGameHours(cfg: ClockConfig, fromMs: number, gameHours: number): number {
  return fromMs + (gameHours * 60 * cfg.secondsPerGameDay * 1000) / GAME_MINUTES_PER_DAY;
}
