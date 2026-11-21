import { describe, expect, it } from 'vitest';
import { SETTING_DEFAULTS } from '../settings/settings.service';
import { available, recipeCost, shelfDays, takeFromLots, type Lot } from './kitchen';

const t0 = Date.parse('2026-01-01T00:00:00Z');
const lot = (id: string, qty: number, expiresAt: number | null): Lot => ({ id, qty, expiresAt: expiresAt === null ? null : new Date(expiresAt) });

describe('cuisine : lots du garde-manger', () => {
  it('prélève d’abord ce qui périme le plus tôt, les lots sans péremption en dernier', () => {
    const lots = [lot('a', 2, null), lot('b', 3, t0 + 2_000), lot('c', 1, t0 + 1_000)];
    expect(takeFromLots(lots, 3, t0)).toEqual([{ id: 'c', take: 1 }, { id: 'b', take: 2 }]);
    expect(takeFromLots(lots, 6, t0)).toEqual([{ id: 'c', take: 1 }, { id: 'b', take: 3 }, { id: 'a', take: 2 }]);
  });
  it('ignore les lots périmés et refuse quand il n’y en a pas assez', () => {
    const lots = [lot('old', 5, t0 - 1), lot('ok', 2, t0 + 10)];
    expect(available(lots, t0)).toBe(2);
    expect(takeFromLots(lots, 3, t0)).toBeNull();
    expect(takeFromLots(lots, 2, t0)).toEqual([{ id: 'ok', take: 2 }]);
  });
  it('le réfrigérateur allonge la conservation, sans jamais en donner à ce qui ne se périme pas', () => {
    expect(shelfDays(4, false, 30_000)).toBe(4);
    expect(shelfDays(4, true, 30_000)).toBe(12);
    expect(shelfDays(0, true, 30_000)).toBe(0);
  });
});

describe('cuisine : réglages par défaut', () => {
  const k = SETTING_DEFAULTS.kitchen;
  const itemById = new Map(k.items.map((i) => [i.id, i]));

  it('toute recette utilise des ingrédients du catalogue', () => {
    for (const r of k.recipes) for (const it of r.items) expect(itemById.has(it.id), `${r.id}: ${it.id}`).toBe(true);
  });
  it('chaque réchaud à charbon ou à gaz a un combustible vendu', () => {
    for (const a of k.appliances.filter((x) => x.kind === 'STOVE' && x.fuel !== 'ELECTRIC')) expect(itemById.has(a.fuelItem ?? ''), a.id).toBe(true);
  });
  it('cuisiner revient moins cher que d’acheter le plat dehors', () => {
    // prix des plats du catalogue (seed) : on vérifie sur ceux qu'on connaît
    const outside: Record<string, number> = { koliko: 300, akoume: 500, ablo: 700, ayimolou: 400, fufu: 1_000, the_omelette: 500, the_pain: 250 };
    for (const r of k.recipes) {
      const cost = recipeCost(r.items, (i) => {
        const it = itemById.get(r.items[i]!.id)!;
        return it.price / it.pack;
      });
      expect(cost / r.portions, r.id).toBeLessThan(outside[r.foodId]!);
    }
  });
});
