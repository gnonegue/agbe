import { describe, expect, it } from 'vitest';
import { energyCost, powerBill, waterBill, waterCost } from './utilities';

const T = [
  { upToKwh: 40, price: 63 },
  { upToKwh: 150, price: 101 },
  { upToKwh: null, price: 120 },
];

describe('facture d’électricité par tranches', () => {
  it('le kWh coûte plus cher quand on consomme plus (tranches)', () => {
    expect(energyCost(0, T)).toBe(0);
    expect(energyCost(40, T)).toBe(40 * 63);
    expect(energyCost(100, T)).toBe(40 * 63 + 60 * 101);
    expect(energyCost(200, T)).toBe(40 * 63 + 110 * 101 + 50 * 120);
  });
  it('proportionnelle à l’équipement et à l’usage, réduite par les panneaux solaires', () => {
    const small = powerBill({ baseKwh: 15, appliancesKwh: 0, cookingKwh: 0, solarBp: 0 }, 500, T);
    const equipped = powerBill({ baseKwh: 15, appliancesKwh: 50, cookingKwh: 10, solarBp: 0 }, 500, T);
    const solar = powerBill({ baseKwh: 15, appliancesKwh: 50, cookingKwh: 10, solarBp: 6_000 }, 500, T);
    expect(small.total).toBe(500 + 15 * 63);
    expect(equipped.total).toBeGreaterThan(small.total);
    expect(solar.kwh).toBe(30);
    expect(solar.total).toBeLessThan(equipped.total);
  });
});

describe('facture d’eau par tranches', () => {
  const W = [
    { upToM3: 10, price: 300 },
    { upToM3: 30, price: 450 },
    { upToM3: null, price: 600 },
  ];
  it('le m³ coûte plus cher au-delà de chaque tranche', () => {
    expect(waterCost(5_000, W)).toBe(1_500);
    expect(waterCost(20_000, W)).toBe(3_000 + 4_500);
    expect(waterCost(40_000, W)).toBe(3_000 + 9_000 + 6_000);
  });
  it('proportionnelle aux douches et à la cuisine', () => {
    const none = waterBill({ baseLitres: 2_000, showers: 0, showerLitres: 80, cookingLitres: 0 }, 500, W);
    const used = waterBill({ baseLitres: 2_000, showers: 30, showerLitres: 80, cookingLitres: 300 }, 500, W);
    expect(none.total).toBe(500 + 600);
    expect(used.litres).toBe(2_000 + 2_400 + 300);
    expect(used.total).toBeGreaterThan(none.total);
  });
});
