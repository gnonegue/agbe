import { describe, expect, it } from 'vitest';
import { familyDay, familyHelp, illnessDay, illnessRiskBp, outageHours, pickWeighted } from './life';
import { activeEvents, transportFactorBp, wholesaleFactorBp } from './events';

const rules = { dailyRiskBp: 250, dirtyBelow: 30, dirtyMultiplierBp: 20_000, weakBelow: 40, weakMultiplierBp: 15_000 };
const ill = [
  { id: 'paludisme', weight: 50, dailyHealth: 8, dailyEnergy: 10, selfHealDays: 0 },
  { id: 'grippe', weight: 50, dailyHealth: 3, dailyEnergy: 6, selfHealDays: 5 },
];
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('vie quotidienne', () => {
  it('majore le risque avec une hygiène et une santé basses', () => {
    expect(illnessRiskBp({ hygiene: 80, health: 90 }, rules)).toBe(250);
    expect(illnessRiskBp({ hygiene: 10, health: 90 }, rules)).toBe(500);
    expect(illnessRiskBp({ hygiene: 10, health: 20 }, rules)).toBe(750);
  });

  it('tire une maladie pondérée quand le risque tombe', () => {
    expect(pickWeighted(ill, () => 60)?.id).toBe('grippe');
    const r = illnessDay({ day: 10, needs: { hygiene: 80, health: 90 }, current: null }, ill, rules, seq(100, 10));
    expect(r.fellIll).toBe('paludisme');
    expect(r.effects).toEqual({ health: -8, energy: -10 });
    expect(illnessDay({ day: 10, needs: { hygiene: 80, health: 90 }, current: null }, ill, rules, seq(9_000)).illness).toBeNull();
  });

  it('aggrave une maladie en cours et guérit seule une grippe après 5 jours', () => {
    expect(illnessDay({ day: 12, needs: { hygiene: 80, health: 90 }, current: { id: 'paludisme', day: 1 } }, ill, rules, seq(0)).effects).toEqual({ health: -8, energy: -10 });
    expect(illnessDay({ day: 6, needs: { hygiene: 80, health: 90 }, current: { id: 'grippe', day: 1 } }, ill, rules, seq(0)).healed).toBe(true);
  });

  it('famille : une demande à la fois, aide quand le solde est bas', () => {
    const fr = { dailyRequestBp: 400, requests: [{ id: 'scolarite', amount: { POOR: 5_000, MIDDLE: 15_000, RICH: 50_000 } }] };
    expect(familyDay({ condition: 'MIDDLE', pending: false }, fr, seq(10, 0))).toEqual({ kind: 'scolarite', amount: 15_000 });
    expect(familyDay({ condition: 'MIDDLE', pending: true }, fr, seq(0))).toBeNull();
    const help = { helpBelow: 2_000, helpChanceBp: { POOR: 1_000, MIDDLE: 2_500, RICH: 5_000 }, helpAmount: { POOR: 2_000, MIDDLE: 5_000, RICH: 15_000 } };
    expect(familyHelp({ condition: 'RICH', balance: 500n }, help, seq(100))).toBe(15_000);
    expect(familyHelp({ condition: 'RICH', balance: 5_000n }, help, seq(0))).toBe(0);
  });

  it('coupure : durée dans l’intervalle', () => {
    expect(outageHours(1_500, [2, 10], seq(10, 3))).toBe(5);
    expect(outageHours(1_500, [2, 10], seq(9_999))).toBe(0);
  });
});

describe('événements économiques', () => {
  const events = [
    { id: 'toujours', weeklyBp: 10_000, wholesaleBp: { gari: 8_000, '*': 11_000 }, transportBp: 15_000 },
    { id: 'jamais', weeklyBp: 0, wholesaleBp: { '*': 50_000 }, transportBp: 50_000 },
  ];
  it('sont identiques pour tous et s’appliquent aux prix', () => {
    expect(activeEvents(14, events).map((e) => e.id)).toEqual(['toujours']);
    expect(wholesaleFactorBp('gari', 14, events)).toBe(8_000);
    expect(wholesaleFactorBp('savon', 14, events)).toBe(11_000);
    expect(transportFactorBp(14, events)).toBe(15_000);
  });
});
