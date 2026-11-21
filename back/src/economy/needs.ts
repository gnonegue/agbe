import { clamp } from './money';

export interface Needs {
  hunger: number;
  energy: number;
  hygiene: number;
  health: number;
  morale: number;
  respect: number;
}

export interface NeedsDecayConfig {
  /** Perte par heure de jeu. */
  perGameHour: { hunger: number; energy: number; hygiene: number; morale: number };
  /** Hors ligne, le personnage se repose : on plafonne la dégradation à ce nombre d'heures de jeu. */
  maxDecayGameHours: number;
  /** Perte de santé par heure de jeu quand faim ou énergie est à 0. */
  healthLossWhenStarving: number;
  /**
   * Absence prolongée (au moins ce nombre d'heures de jeu sans action) : le personnage s'est reposé et nourri comme il a pu. Sa faim,
   * son énergie, son hygiène et son moral ne descendent pas sous `offlineFloor`, et il ne perd aucune santé de ce fait.
   */
  offlineAfterGameHours?: number;
  offlineFloor?: number;
}

export interface MealEnergyRule {
  /** Gain de faim minimal pour que le plat compte comme un vrai repas (une boisson ou une bouchée ne suffit pas). */
  minHunger: number;
  /** Énergie minimale après un repas (0-100). */
  energyFloor: number;
}

/** Après un vrai repas, l'énergie remonte au moins au plancher ; elle n'est jamais abaissée. Fonction pure. */
export function withMealEnergy(next: Needs, hungerGain: number | null | undefined, rule: MealEnergyRule): Needs {
  if ((hungerGain ?? 0) < rule.minHunger) return next;
  return { ...next, energy: Math.max(next.energy, clamp(rule.energyFloor)) };
}

/** Applique l'usure des besoins sur `elapsedGameHours`, avec plafond hors ligne. Fonction pure. */
export function decayNeeds(needs: Needs, elapsedGameHours: number, cfg: NeedsDecayConfig): Needs {
  const h = Math.max(0, Math.min(elapsedGameHours, cfg.maxDecayGameHours));
  if (h === 0) return { ...needs };
  // Longue absence : plancher hors ligne (jamais abaissé sous le niveau d'avant le départ s'il était déjà plus bas)
  const away = cfg.offlineAfterGameHours !== undefined && elapsedGameHours >= cfg.offlineAfterGameHours && (cfg.offlineFloor ?? 0) > 0;
  const floorOf = (before: number) => (away ? Math.min(before, cfg.offlineFloor ?? 0) : 0);
  const hunger = Math.max(floorOf(needs.hunger), clamp(needs.hunger - cfg.perGameHour.hunger * h));
  const energy = Math.max(floorOf(needs.energy), clamp(needs.energy - cfg.perGameHour.energy * h));
  const hygiene = Math.max(floorOf(needs.hygiene), clamp(needs.hygiene - cfg.perGameHour.hygiene * h));
  let morale = Math.max(floorOf(needs.morale), clamp(needs.morale - cfg.perGameHour.morale * h));
  let health = needs.health;
  if (!away && (hunger === 0 || energy === 0)) {
    health = clamp(health - cfg.healthLossWhenStarving * h);
    morale = clamp(morale - cfg.perGameHour.morale * h);
  }
  return { hunger, energy, hygiene, health, morale, respect: needs.respect };
}

export function applyEffects(needs: Needs, effects: Partial<Needs>): Needs {
  return {
    hunger: clamp(needs.hunger + (effects.hunger ?? 0)),
    energy: clamp(needs.energy + (effects.energy ?? 0)),
    hygiene: clamp(needs.hygiene + (effects.hygiene ?? 0)),
    health: clamp(needs.health + (effects.health ?? 0)),
    morale: clamp(needs.morale + (effects.morale ?? 0)),
    respect: clamp(needs.respect + (effects.respect ?? 0)),
  };
}
