import { describe, expect, it } from 'vitest';
import { priceBounds, rankOf, saleSplit } from './market';

describe('marché entre joueurs', () => {
  it('borne le prix au double du prix de gros pour une marge de 200 %', () => {
    expect(priceBounds(700, 20_000)).toEqual({ min: 1, max: 1400 });
  });
  it('partage la vente entre vendeur et taxe de marché', () => {
    expect(saleSplit(1000, 3, 200)).toEqual({ total: 3000n, tax: 60n, net: 2940n });
    expect(() => saleSplit(0, 1, 200)).toThrow();
  });
  it('donne le rang de revendeuse jusqu’à Nana Benz', () => {
    const ranks = [{ id: 'revendeuse', minSales: 0 }, { id: 'grossiste', minSales: 2_000_000 }, { id: 'nana_benz', minSales: 20_000_000 }];
    expect(rankOf(0n, ranks)).toEqual({ id: 'revendeuse', next: ranks[1] });
    expect(rankOf(2_000_000n, ranks).id).toBe('grossiste');
    expect(rankOf(25_000_000n, ranks)).toEqual({ id: 'nana_benz', next: null });
  });
});
