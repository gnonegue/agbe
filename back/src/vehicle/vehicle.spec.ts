import { describe, expect, it } from 'vitest';
import { breakdownRiskBp, condition, fuelNeededMl, overdueRatioBp, resaleValue } from './vehicle';

const moto = { serviceEveryKm: 1_000, mlPerKm: 28 };

describe('Véhicules : carburant, usure, pannes, revente', () => {
  it('consomme le carburant au prorata de la distance (ml, arrondi au supérieur)', () => {
    expect(fuelNeededMl(10_000, moto)).toBe(280); // 10 km × 28 ml
    expect(fuelNeededMl(1, moto)).toBe(1);
    expect(fuelNeededMl(0, moto)).toBe(0);
  });

  it('la condition baisse avec l’usure depuis l’entretien et les dégâts, jamais sous 0', () => {
    expect(condition({ sinceServiceM: 0, damage: 0 }, moto)).toBe(100);
    expect(condition({ sinceServiceM: 1_000_000, damage: 0 }, moto)).toBe(60); // un intervalle : -40
    expect(condition({ sinceServiceM: 1_000_000, damage: 35 }, moto)).toBe(25);
    expect(condition({ sinceServiceM: 9_000_000, damage: 50 }, moto)).toBe(0);
  });

  it('aucune panne tant que l’entretien n’est pas dépassé, puis un risque proportionnel au retard', () => {
    expect(overdueRatioBp(900_000, moto)).toBe(0);
    expect(breakdownRiskBp(1_000_000, moto, { breakdownBpPerOverdue: 2_500 })).toBe(0);
    expect(overdueRatioBp(1_500_000, moto)).toBe(5_000); // demi-intervalle de retard
    expect(breakdownRiskBp(1_500_000, moto, { breakdownBpPerOverdue: 2_500 })).toBe(1_250);
    expect(breakdownRiskBp(99_000_000, moto, { breakdownBpPerOverdue: 2_500 })).toBe(6_000); // plafonné
  });

  it('la revente décroît avec le kilométrage, a un plancher et tient compte des dégâts', () => {
    const resale = { startBp: 8_500, lossBpPerKm: 4, floorBp: 2_500 };
    const base = { fuelMl: 0, odometerM: 0, sinceServiceM: 0, damage: 0, boughtPrice: 600_000 };
    expect(resaleValue(base, resale)).toBe(510_000);
    expect(resaleValue({ ...base, odometerM: 500_000 }, resale)).toBe(390_000); // 500 km : -20 %
    expect(resaleValue({ ...base, odometerM: 99_000_000 }, resale)).toBe(150_000); // plancher 25 %
    expect(resaleValue({ ...base, damage: 35 }, resale)).toBe(331_500);
  });
});
