import { describe, expect, it } from 'vitest';
import { selectTopCandidates, tenderMinPhysicalHours, tenderRealizationCost, tenderScore } from './tenders';

describe('marchés publics : calculs purs', () => {
  it('coût de réalisation = séances requises × coût du secteur', () => {
    expect(tenderRealizationCost(5, 6_000)).toBe(30_000n);
    expect(tenderRealizationCost(0, 6_000)).toBe(0n);
  });

  it('délai minimum physique = séances requises × durée d’une séance', () => {
    expect(tenderMinPhysicalHours(5, 6)).toBe(30);
    expect(tenderMinPhysicalHours(0, 6)).toBe(0);
  });

  it('score pondéré prix bas + délai court, pondération 70/30 par défaut', () => {
    const weights = { priceBp: 7_000, hoursBp: 3_000 };
    // Prix minimum (0 % du plafond) et délai minimum (0 % du max) : score parfait = 1.
    expect(tenderScore({ proposedPrice: 0n, proposedHours: 0 }, 100_000n, 100, weights)).toBeCloseTo(1, 5);
    // Prix au plafond et délai au max : score nul.
    expect(tenderScore({ proposedPrice: 100_000n, proposedHours: 100 }, 100_000n, 100, weights)).toBeCloseTo(0, 5);
    // Prix à 50 % du plafond, délai à 50 % du max : score = 0,5 quelle que soit la pondération.
    expect(tenderScore({ proposedPrice: 50_000n, proposedHours: 50 }, 100_000n, 100, weights)).toBeCloseTo(0.5, 5);
    // Prix bas (10 %) mais délai long (90 %) : la pondération 70/30 favorise le prix bas.
    const cheapButSlow = tenderScore({ proposedPrice: 10_000n, proposedHours: 90 }, 100_000n, 100, weights);
    const fastButExpensive = tenderScore({ proposedPrice: 90_000n, proposedHours: 10 }, 100_000n, 100, weights);
    expect(cheapButSlow).toBeGreaterThan(fastButExpensive);
  });

  it('sélectionne les meilleurs scores, départage déterministe par ancienneté puis id', () => {
    const candidates = [
      { id: 'b', score: 0.8, createdAtMs: 200 },
      { id: 'a', score: 0.8, createdAtMs: 100 }, // même score, plus ancienne : gagne le départage
      { id: 'c', score: 0.5, createdAtMs: 50 },
    ];
    const { selected, rejected } = selectTopCandidates(candidates, 2);
    expect(selected.map((x) => x.id)).toEqual(['a', 'b']);
    expect(rejected.map((x) => x.id)).toEqual(['c']);
  });

  it('aucun tirage aléatoire : même entrée, même sortie', () => {
    const candidates = [
      { id: 'x', score: 0.3, createdAtMs: 1 },
      { id: 'y', score: 0.9, createdAtMs: 2 },
    ];
    const r1 = selectTopCandidates(candidates, 1);
    const r2 = selectTopCandidates(candidates, 1);
    expect(r1.selected.map((x) => x.id)).toEqual(r2.selected.map((x) => x.id));
    expect(r1.selected.map((x) => x.id)).toEqual(['y']);
  });
});
