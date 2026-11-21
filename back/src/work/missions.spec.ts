import { describe, expect, it } from 'vitest';
import { generateMissions } from './missions';

const zem = { base: 100, perKm: 75, roundTo: 50, energyPerKm: 0, riskBp: 150 };
const places = [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 30, z: 40 }, { id: 'c', x: -50, z: -20 }];

describe('missions', () => {
  it('livraisons : colis entre deux lieux différents, montant entier ≥ forfait', () => {
    const m = generateMissions({ seed: 'd1', source: 'delivery_driver', count: 5, target: 4000, costRatioBp: 0, places, zem });
    expect(m).toHaveLength(5);
    expect(m.every((x) => x.kind === 'delivery' && x.from !== x.to && !!x.item && Number.isInteger(x.amount) && x.amount >= 25 && x.cost === 0)).toBe(true);
  });

  it('livraisons enchaînées : le colis suivant se récupère près du dernier point de dépôt, pas à l’autre bout de la ville', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, x: (i % 4) * 400, z: Math.floor(i / 4) * 400 }));
    const m = generateMissions({ seed: 'chain', source: 'delivery_driver', count: 6, target: 4000, costRatioBp: 0, places: many, zem, start: 'p0' });
    let at = many[0]!;
    for (const x of m) {
      // Parmi les lieux proches (les lieux visités juste avant sont écartés, d'où un rang un peu plus large que 3)
      const ranked = many.filter((p) => p.id !== at.id).sort((p, q) => Math.hypot(at.x - p.x, at.z - p.z) - Math.hypot(at.x - q.x, at.z - q.z)).slice(0, 7).map((p) => p.id);
      expect(ranked).toContain(x.from);
      at = many.find((p) => p.id === x.to)!;
    }
  });

  it('courses de zém au tarif réel de la distance, déterministes', () => {
    const m = generateMissions({ seed: 's1', source: 'zem_driver', count: 5, target: 3500, costRatioBp: 0, places, zem });
    expect(m).toEqual(generateMissions({ seed: 's1', source: 'zem_driver', count: 5, target: 3500, costRatioBp: 0, places, zem }));
    expect(m.every((x) => x.kind === 'ride' && x.from !== x.to && Number.isInteger(x.amount) && x.amount > 0)).toBe(true);
    // Courses enchaînées depuis le lieu de départ
    const c = generateMissions({ seed: 's1', source: 'zem_driver', count: 4, target: 3500, costRatioBp: 0, places, zem, start: 'b' });
    expect(c[0]!.from).toBe('b');
    for (let i = 1; i < c.length; i++) expect(c[i]!.from).toBe(c[i - 1]!.to);
  });
  it('ventes : montants entiers, plafonnés près de la paie de référence', () => {
    const m = generateMissions({ seed: 's2', source: 'street_vendor', count: 8, target: 2500, costRatioBp: 0, places, zem });
    const total = m.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeLessThanOrEqual(2500 * 1.4 + 8 * 25);
    expect(m.every((x) => Number.isInteger(x.amount) && x.amount >= 25)).toBe(true);
  });
  it('entreprise : les charges sont une part du chiffre d’affaires', () => {
    const m = generateMissions({ seed: 's3', source: 'maquis', count: 4, target: 12000, costRatioBp: 6667, places, zem });
    for (const x of m) expect(x.cost).toBeLessThanOrEqual(x.amount);
  });
});

describe('courses variées (pas de circuit sur les mêmes endroits)', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, x: (i % 4) * 400, z: Math.floor(i / 4) * 400 }));
  for (const source of ['zem_driver', 'delivery_driver']) {
    it(`${source} : aucun lieu ne revient dans les 4 étapes suivantes, pas d'aller-retour`, () => {
      for (let seed = 0; seed < 30; seed++) {
        const ms = generateMissions({ seed: `s${seed}`, source, count: 8, target: 1e9, costRatioBp: 0, places: many, zem, start: 'p0' });
        const stops = ms.flatMap((m) => (source === 'zem_driver' ? [m.to!] : [m.from!, m.to!]));
        for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < Math.min(stops.length, i + 4); j++) expect(stops[j]).not.toBe(stops[i]);
      }
    });
  }
});
