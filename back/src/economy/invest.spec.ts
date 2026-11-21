import { describe, expect, it } from 'vitest';
import { accrued, savingsInterest, stockHistory, stockPrice } from './invest';

describe('investissements', () => {
  it('cours déterministe, jamais sous le plancher, multiple de 5', () => {
    const a = stockPrice('LCIM', 5_000, 5, 300, 40);
    expect(a).toBe(stockPrice('LCIM', 5_000, 5, 300, 40));
    for (let d = 0; d < 60; d++) {
      const p = stockPrice('TEST', 50, -50, 900, d);
      expect(p).toBeGreaterThanOrEqual(5);
      expect(p % 5).toBe(0);
    }
    expect(stockPrice('LCIM', 5_000, 5, 300, 0)).toBe(5_000);
  });
  it('cours borné sur des années : ni explosion ni blocage au plancher, et il bouge chaque jour', () => {
    for (const [sym, base, drift, vol] of [['GOZEM', 2_200, 8, 420], ['WAXI', 1_800, 1, 340], ['NSIA', 5_400, 3, 150]] as const) {
      let still = 0;
      let prev = stockPrice(sym, base, drift, vol, 0);
      for (let d = 1; d <= 8_000; d++) {
        const p = stockPrice(sym, base, drift, vol, d);
        expect(p).toBeGreaterThan(base / 5);
        expect(p).toBeLessThan(base * 5);
        if (p === prev) still++;
        prev = p;
      }
      expect(still).toBeLessThan(400);
    }
  });
  it('cours qui change dans la journée et historique ordonné sur la période', () => {
    const day = [0, 1, 2, 3, 4, 5].map((h) => stockPrice('GOZEM', 2_200, 8, 420, 100 + h / 24));
    expect(new Set(day).size).toBeGreaterThan(1);
    const h = stockHistory('GOZEM', 2_200, 8, 420, 100.5, '7d');
    expect(h[h.length - 1]!.p).toBe(stockPrice('GOZEM', 2_200, 8, 420, 100.5));
    expect(h[0]!.t).toBeCloseTo(93.5, 5);
    for (let i = 1; i < h.length; i++) expect(h[i]!.t).toBeGreaterThan(h[i - 1]!.t);
    expect(stockHistory('GOZEM', 2_200, 8, 420, 3, '1y')[0]!.t).toBe(0);
  });
  it('revenu cumulé linéaire, borné par la durée et par l’échec', () => {
    expect(accrued(10_000n, 10, 5, 10)).toBe(5_000n);
    expect(accrued(10_000n, 10, 50, 10)).toBe(10_000n);
    expect(accrued(10_000n, 10, 8, 3)).toBe(3_000n);
    expect(accrued(10_000n, 10, -2, 10)).toBe(0n);
  });
  it('intérêts d’épargne simples, arrondis au franc inférieur', () => {
    expect(savingsInterest(100_000n, 3, 10)).toBe(300n);
    expect(savingsInterest(1_000n, 3, 1)).toBe(0n);
    expect(savingsInterest(100_000n, 3, 0)).toBe(0n);
  });
});
