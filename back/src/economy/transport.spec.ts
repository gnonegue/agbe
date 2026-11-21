import { describe, expect, it } from 'vitest';
import { distanceMeters, fare, travelEnergy, type TransportModeConfig } from './transport';

const zem: TransportModeConfig = { base: 100, perKm: 75, roundTo: 50, energyPerKm: 0, riskBp: 150 };
const walk: TransportModeConfig = { base: 0, perKm: 0, roundTo: 1, energyPerKm: 4, riskBp: 0 };

describe('transport', () => {
  it('mesure la distance en mètres (10 unités = 1 km)', () => {
    expect(distanceMeters(0, 0, 30, 40)).toBe(5000);
    expect(distanceMeters(5, 5, 5, 5)).toBe(0);
  });
  it('calcule un tarif entier arrondi au multiple supérieur', () => {
    expect(fare(5000, zem)).toBe(500n); // 100 + 375 = 475 → 500
    expect(fare(1000, zem)).toBe(200n); // 175 → 200
    expect(fare(1, zem)).toBe(150n); // 101 → 150
  });
  it('est gratuit à pied ou sur place', () => {
    expect(fare(8000, walk)).toBe(0n);
    expect(fare(0, zem)).toBe(0n);
  });
  it('fatigue plafonnée', () => {
    expect(travelEnergy(2500, walk)).toBe(10);
    expect(travelEnergy(100_000, walk)).toBe(40);
    expect(travelEnergy(5000, zem)).toBe(0);
  });
});
