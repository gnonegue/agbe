import { describe, expect, it } from 'vitest';
import { decayNeeds, withMealEnergy, type Needs } from './needs';

const base: Needs = { hunger: 40, energy: 30, hygiene: 50, health: 80, morale: 60, respect: 10 };
const rule = { minHunger: 20, energyFloor: 70 };

describe('Repas et énergie', () => {
  it('un vrai repas remonte l’énergie à 70 % au moins', () => {
    expect(withMealEnergy(base, 35, rule).energy).toBe(70);
  });
  it('ne baisse jamais une énergie déjà plus haute', () => {
    expect(withMealEnergy({ ...base, energy: 90 }, 35, rule).energy).toBe(90);
  });
  it('une boisson ou une bouchée (peu de faim) ne compte pas comme un repas', () => {
    expect(withMealEnergy(base, 3, rule).energy).toBe(30);
    expect(withMealEnergy(base, undefined, rule).energy).toBe(30);
    expect(withMealEnergy(base, 19, rule).energy).toBe(30);
  });
  it('ne touche pas aux autres besoins', () => {
    expect(withMealEnergy(base, 35, rule)).toEqual({ ...base, energy: 70 });
  });
});

describe('absence prolongée (plancher hors ligne)', () => {
  const cfg = { perGameHour: { hunger: 2, energy: 2, hygiene: 1, morale: 1 }, maxDecayGameHours: 12, healthLossWhenStarving: 2, offlineAfterGameHours: 3, offlineFloor: 25 };
  const start = { hunger: 30, energy: 30, hygiene: 30, health: 80, morale: 30, respect: 40 };
  it('ne descend pas sous le plancher et ne coûte aucune santé', () => {
    const n = decayNeeds(start, 12, cfg);
    expect(n.hunger).toBe(25);
    expect(n.energy).toBe(25);
    expect(n.health).toBe(80);
    expect(n.respect).toBe(40);
  });
  it('un besoin déjà plus bas que le plancher ne baisse pas davantage', () => {
    const n = decayNeeds({ ...start, hunger: 10, energy: 0 }, 12, cfg);
    expect(n.hunger).toBe(10);
    expect(n.energy).toBe(0);
    expect(n.health).toBe(80);
  });
  it('une courte absence garde le rythme normal (et la santé baisse à jeun)', () => {
    const n = decayNeeds({ ...start, hunger: 2 }, 2, cfg);
    expect(n.hunger).toBe(0);
    expect(n.health).toBe(76);
  });
});
