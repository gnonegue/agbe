import { describe, expect, it } from 'vitest';
import { applyRate, toAmount } from './money';
import { gameTimeAt, gameHoursBetween, realMsAfterGameHours } from './clock';
import { decayNeeds, applyEffects, Needs } from './needs';
import { computePayroll, progressiveTax, PayrollRates } from './payroll';
import { drawCondition } from './destiny';

const RATES: PayrollRates = {
  smig: 52_500,
  cnssEmployeeBp: 400,
  cnssEmployerBp: 1750,
  amuEmployeeBp: 500,
  amuEmployerBp: 500,
  irppBrackets: [],
};

describe('money', () => {
  it('applies basis-point rates on integers with half-up rounding', () => {
    expect(applyRate(52_500n, 400)).toBe(2_100n);
    expect(applyRate(52_500n, 1750)).toBe(9_188n); // 9187.5 → 9188
    expect(applyRate(0n, 1750)).toBe(0n);
  });
  it('rejects floats, NaN and malformed strings', () => {
    expect(() => toAmount(1.5)).toThrow();
    expect(() => toAmount(Number.NaN)).toThrow();
    expect(() => toAmount('12; DROP TABLE wallet')).toThrow();
    expect(() => applyRate(100n, 1.5)).toThrow();
    expect(() => applyRate(100n, -1)).toThrow();
    expect(toAmount('1000')).toBe(1000n);
  });
});

describe('clock', () => {
  const cfg = { epochRealMs: 0, secondsPerGameDay: 3600 };
  it('1 real hour = 1 game day; 1 game hour = 150 real seconds', () => {
    expect(gameTimeAt(cfg, 3600_000).day).toBe(1);
    expect(gameTimeAt(cfg, 150_000)).toMatchObject({ day: 0, hour: 1, minute: 0 });
    expect(gameHoursBetween(cfg, 0, 150_000)).toBeCloseTo(1);
    expect(realMsAfterGameHours(cfg, 0, 4)).toBe(600_000); // CFE : 4 h de jeu ≈ 10 min
  });
  it('a game month is 30 game days', () => {
    const t = gameTimeAt(cfg, 31 * 3600_000);
    expect(t.month).toBe(1);
    expect(t.dayOfMonth).toBe(2);
  });
});

describe('needs', () => {
  const base: Needs = { hunger: 80, energy: 80, hygiene: 80, health: 90, morale: 70, respect: 10 };
  const cfg = { perGameHour: { hunger: 4, energy: 3, hygiene: 2, morale: 1 }, maxDecayGameHours: 12, healthLossWhenStarving: 2 };
  it('decays per game hour', () => {
    expect(decayNeeds(base, 5, cfg)).toMatchObject({ hunger: 60, energy: 65, hygiene: 70, morale: 65, health: 90 });
  });
  it('caps offline decay so needs do not collapse', () => {
    expect(decayNeeds(base, 10_000, cfg)).toEqual(decayNeeds(base, 12, cfg));
  });
  it('never leaves 0..100 bounds', () => {
    const n = applyEffects(base, { hunger: 500, morale: -500 });
    expect(n.hunger).toBe(100);
    expect(n.morale).toBe(0);
  });
});

describe('payroll', () => {
  it('computes SMIG payroll', () => {
    const p = computePayroll(52_500n, RATES);
    expect(p.cnssEmployee).toBe(2_100n);
    expect(p.amuEmployee).toBe(2_625n);
    expect(p.net).toBe(52_500n - 2_100n - 2_625n);
    expect(p.employerCost).toBe(52_500n + 9_188n + 2_625n);
    expect(p.belowSmig).toBe(false);
  });
  it('uses SMIG as AMU minimum base for low salaries', () => {
    const p = computePayroll(30_000n, RATES);
    expect(p.amuBase).toBe(52_500n);
    expect(p.belowSmig).toBe(true);
  });
  it('handles a high salary with progressive IRPP brackets', () => {
    const brackets = [
      { from: 0, rateBp: 0 },
      { from: 100_000, rateBp: 1000 },
      { from: 500_000, rateBp: 2000 },
    ];
    expect(progressiveTax(50_000n, brackets)).toBe(0n);
    expect(progressiveTax(600_000n, brackets)).toBe(40_000n + 20_000n);
    const p = computePayroll(1_000_000n, { ...RATES, irppBrackets: brackets });
    expect(p.net + p.cnssEmployee + p.amuEmployee + p.irpp).toBe(p.gross);
  });
});

describe('destiny', () => {
  it('follows weights deterministically with injected rng', () => {
    const w = { POOR: 55, MIDDLE: 38, RICH: 7 };
    expect(drawCondition(w, () => 0)).toBe('POOR');
    expect(drawCondition(w, () => 54)).toBe('POOR');
    expect(drawCondition(w, () => 55)).toBe('MIDDLE');
    expect(drawCondition(w, () => 93)).toBe('RICH');
  });
  it('rejects empty weights', () => {
    expect(() => drawCondition({ POOR: 0, MIDDLE: 0, RICH: 0 })).toThrow();
  });
});
