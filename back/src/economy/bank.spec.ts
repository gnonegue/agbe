import { describe, expect, it } from 'vitest';
import { matured, simpleInterest } from './bank';

describe('banque', () => {
  it('intérêts simples sur la durée, en entiers', () => {
    // 1 000 000 FCFA à 5,25 % sur 12 mois (360 jours) = 52 500 FCFA
    expect(simpleInterest(1_000_000n, 525, 360)).toBe(52_500n);
    // 3 mois = un quart
    expect(simpleInterest(1_000_000n, 400, 90)).toBe(10_000n);
    expect(simpleInterest(999n, 350, 1)).toBe(0n);
    expect(simpleInterest(0n, 500, 30)).toBe(0n);
    expect(simpleInterest(100_000n, 500, -3)).toBe(0n);
  });

  it('échéance du dépôt à terme', () => {
    expect(matured(10, 90, 99)).toBe(false);
    expect(matured(10, 90, 100)).toBe(true);
  });
});
