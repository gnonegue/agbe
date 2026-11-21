import type { GameTime } from '../api/types';

/** Horloge de jeu interpolée côté client entre deux rafraîchissements du serveur. */
export class GameClock {
  private baseMinutes = 0;
  private baseReal = performance.now();
  private minutesPerMs = 1440 / (3600 * 1000);

  sync(t: GameTime, secondsPerGameDay: number): void {
    const total = t.totalMinutes > 0 ? t.totalMinutes : t.day * 1440 + t.hour * 60 + t.minute;
    const spd = secondsPerGameDay > 0 ? secondsPerGameDay : 3600;
    this.minutesPerMs = 1440 / (spd * 1000);
    const predicted = this.totalMinutes();
    // Petits écarts : on garde la valeur prédite pour éviter les sauts en arrière visibles.
    if (Math.abs(predicted - total) > 2 || this.baseMinutes === 0) {
      this.baseMinutes = total;
      this.baseReal = performance.now();
    }
  }

  /** Durée réelle (ms) d'une minute de jeu. */
  msPerMinute(): number {
    return 1 / this.minutesPerMs;
  }

  totalMinutes(): number {
    return this.baseMinutes + (performance.now() - this.baseReal) * this.minutesPerMs;
  }

  /** Minute de la journée (0–1440, fractionnaire). */
  minuteOfDay(): number {
    const m = this.totalMinutes() % 1440;
    return m < 0 ? m + 1440 : m;
  }

  parts(): { day: number; hour: number; minute: number; month: number; dayOfMonth: number } {
    const total = Math.floor(this.totalMinutes());
    const day = Math.floor(total / 1440);
    const mod = total % 1440;
    return { day, hour: Math.floor(mod / 60), minute: mod % 60, month: Math.floor(day / 30), dayOfMonth: (day % 30) + 1 };
  }
}
