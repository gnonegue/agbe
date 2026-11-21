import { describe, expect, it } from 'vitest';
import { dayPrice, remoteSellPrice, tax } from './trade';

describe('commerce', () => {
  it('prix du jour déterministe, dans la fourchette, multiple de 25', () => {
    for (let d = 0; d < 50; d++) {
      const p = dayPrice(10_000, 'riz', 'buy', d, 1200);
      expect(p).toBe(dayPrice(10_000, 'riz', 'buy', d, 1200));
      expect(p).toBeGreaterThanOrEqual(8_800);
      expect(p).toBeLessThanOrEqual(11_200);
      expect(p % 25).toBe(0);
    }
  });
  it('le prix change selon le jour', () => {
    const set = new Set(Array.from({ length: 20 }, (_, d) => dayPrice(10_000, 'riz', 'sell', d, 1200)));
    expect(set.size).toBeGreaterThan(5);
  });
  it('taxe arrondie au franc supérieur, en BigInt', () => {
    expect(tax(10_001n, 1000)).toBe(1_001n);
    expect(tax(10_000n, 1000)).toBe(1_000n);
    expect(tax(0n, 2000)).toBe(0n);
  });

  it('cours de rachat à distance : sous le prix d\'achat, multiple de 25, jamais de gain immédiat', () => {
    expect(remoteSellPrice(5_000, 800)).toBe(4_600);
    expect(remoteSellPrice(5_010, 800)).toBe(4_600);
    expect(remoteSellPrice(30, 800)).toBe(25);
    for (let d = 0; d < 50; d++) {
      const buy = dayPrice(5_000, 'karite', 'buy', d, 1200);
      expect(remoteSellPrice(buy, 800)).toBeLessThan(buy);
      expect(remoteSellPrice(buy, 800) % 25).toBe(0);
    }
  });
});

import { dailySellLimit, remoteBuyPrice, sellQuote } from './trade';

describe('plafond de marge et achat à distance', () => {
  it('plafonne la revente à la marge maximale sur le coût de revient', () => {
    // Karité : achat 5 000, revente brute 7 500 (+50 %) : plafonnée à +12 % → 5 600
    expect(sellQuote(5_000, 7_500, 'EXPORT', 300, 1_200)).toBe(5_600);
    // Un cours de revente déjà plus bas n'est pas relevé
    expect(sellQuote(5_000, 5_100, 'EXPORT', 300, 1_200)).toBe(5_100);
  });
  it('compte les droits de douane dans le coût de revient d\'un import', () => {
    // Riz : 9 000 + 10 % de douane = 9 900 ; +12 % → 11 088 → 11 075 (pas de 25) ; la revente brute 11 500 est plafonnée
    expect(sellQuote(9_000, 11_500, 'IMPORT', 1_000, 1_200)).toBe(11_075);
  });
  it("un achat à distance coûte le prix du port plus l'écart, et laisse un gain si on revend sur place", () => {
    for (const [buy, sell, kind, taxBp] of [[5_000, 7_500, 'EXPORT', 300], [12_000, 15_500, 'LOCAL', 0], [9_000, 11_500, 'IMPORT', 1_000], [900_000, 1_250_000, 'CAR', 2_500]] as const) {
      const quote = sellQuote(buy, sell, kind, taxBp, 3_800);
      const remote = remoteBuyPrice(buy, 500);
      expect(remote).toBeGreaterThan(buy); // un peu plus cher que le port
      expect(remote).toBeGreaterThanOrEqual(Math.ceil((buy * 1.05) / 25) * 25);
      expect(remote).toBeLessThan(quote); // mais la revente sur place reste bénéficiaire
    }
  });
  it('limite quotidienne de vente : part du stock maximal, au moins une unité', () => {
    // Entre 5 et 25 par jour, quelle que soit la marchandise, et ça varie d'un jour à l'autre
    const seen = new Set<number>();
    for (let day = 0; day < 200; day++) {
      const n = dailySellLimit('riz_sac', day);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(25);
      seen.add(n);
    }
    expect(seen.size).toBeGreaterThan(10);
    // Même jour, même marchandise : même limite pour tous ; marchandises différentes : limites indépendantes
    expect(dailySellLimit('riz_sac', 7)).toBe(dailySellLimit('riz_sac', 7));
    expect(new Set(['riz_sac', 'poisson_carton', 'ciment', 'huile', 'pagne'].map((g) => dailySellLimit(g, 3))).size).toBeGreaterThan(1);
  });
});

// Régression : « les joueurs perdent toujours au commerce ». Même le pire jour (achat au plus haut, revente au plus bas),
// un trajet complet des réglages par défaut doit rester bénéficiaire.
import { SETTING_DEFAULTS } from '../settings/settings.service';
describe('commerce : un trajet complet gagne toujours (réglages par défaut)', () => {
  const cfg = SETTING_DEFAULTS['port.goods'];
  for (const g of cfg.goods) {
    it(`${g.id} : bénéfice même le pire jour`, () => {
      const buy = Math.ceil((g.buyPrice * (10_000 + cfg.swingBp)) / 10_000 / 25) * 25;
      const sell = Math.floor((g.sellPrice * (10_000 - cfg.swingBp)) / 10_000 / 25) * 25;
      const quote = sellQuote(buy, sell, g.kind, g.taxBp, cfg.maxMarginBp);
      const duty = g.kind === 'IMPORT' || g.kind === 'CAR' ? Number(tax(BigInt(buy), g.taxBp)) : 0;
      const exportTax = g.kind === 'EXPORT' ? Number(tax(BigInt(quote), g.taxBp)) : 0;
      expect(quote - exportTax).toBeGreaterThan(buy + duty);
    });
  }
});
