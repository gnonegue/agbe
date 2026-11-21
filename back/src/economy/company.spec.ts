import { describe, expect, it } from 'vitest';
import { candidatesFor, cfeFee, computeDeclaration, type ContributionConfig } from './company';

const cfe = { feeEI: 25_400, feeSociety: 28_250, feeSocietyNonEcowas: 33_250, delayGameHours: 4 };
const cfg: ContributionConfig = { cnssTnsBp: 2150, amuTnsMonthly: 10_000, otrBp: 500, penaltyBpPerMonth: 1000, graceDays: 15, unregisteredFine: 25_000, maxEmployees: 8 };

describe('entreprise', () => {
  it('frais CFE réels selon la forme et la nationalité', () => {
    expect(cfeFee('EI', false, cfe)).toBe(25_400n);
    expect(cfeFee('EI', true, cfe)).toBe(25_400n);
    expect(cfeFee('SARL', false, cfe)).toBe(28_250n);
    expect(cfeFee('SA', true, cfe)).toBe(33_250n);
  });

  it('rien à déclarer tant que le premier mois n’est pas clos', () => {
    expect(computeDeclaration({ lastDeclaredMonth: -1, createdMonth: 2, today: 75, pendingRevenue: 50_000n }, cfg)).toBeNull();
  });

  it('déclaration à temps : CNSS 21,5 % + AMU forfait + OTR, sans pénalité', () => {
    // Créée au mois 2 (jours 60-89), déclarée le jour 95 (échéance jour 105)
    const d = computeDeclaration({ lastDeclaredMonth: -1, createdMonth: 2, today: 95, pendingRevenue: 100_000n }, cfg)!;
    expect(d).toMatchObject({ fromMonth: 2, toMonth: 2, months: 1, overdueMonths: 0 });
    expect(d.cnss).toBe(21_500n);
    expect(d.amu).toBe(10_000n);
    expect(d.otr).toBe(5_000n);
    expect(d.penalty).toBe(0n);
    expect(d.total).toBe(36_500n);
  });

  it('retard : pénalité par mois de retard sur le total dû', () => {
    // Mois 2 dû le jour 105 ; déclaré le jour 140 → 2 mois de retard pour le mois 2, 1 pour le mois 3 (dû jour 135)
    const d = computeDeclaration({ lastDeclaredMonth: -1, createdMonth: 2, today: 140, pendingRevenue: 100_000n }, cfg)!;
    expect(d).toMatchObject({ fromMonth: 2, toMonth: 3, months: 2, overdueMonths: 3 });
    expect(d.amu).toBe(20_000n);
    const base = 21_500n + 20_000n + 5_000n;
    expect(d.penalty).toBe((base * 3000n + 5000n) / 10_000n);
    expect(d.total).toBe(base + d.penalty);
  });

  it('montants toujours entiers et jamais négatifs', () => {
    const d = computeDeclaration({ lastDeclaredMonth: 4, createdMonth: 0, today: 200, pendingRevenue: 333n }, cfg)!;
    expect(typeof d.total).toBe('bigint');
    expect(d.cnss).toBe(72n);
  });

  it('candidats déterministes, jamais sous le SMIG', () => {
    const a = candidatesFor('c1', 40, 52_500, 3);
    expect(candidatesFor('c1', 40, 52_500, 3)).toEqual(a);
    expect(candidatesFor('c1', 41, 52_500, 3)).not.toEqual(a);
    for (const c of a) {
      expect(c.grossMonthly).toBeGreaterThanOrEqual(52_500);
      expect(c.grossMonthly).toBeLessThanOrEqual(94_500);
      expect(Number.isInteger(c.grossMonthly)).toBe(true);
    }
  });
});

import { autoSale, companySalePrice } from './company';
describe('vente et ventes automatiques', () => {
  const cfg = { maxCompanies: 3, saleShifts: 120, saleShiftsPerEmployee: 40, employeeSaleBp: 3_500, maxCatchUpShifts: 8 };
  const act = { revenue: 9_000, cost: 6_000 };
  it('le prix de vente croît avec les salariés, en entiers', () => {
    expect(companySalePrice(act, 0, cfg)).toBe(360_000n);
    expect(companySalePrice(act, 2, cfg)).toBe(600_000n);
  });
  it('une activité sans bénéfice ne rapporte rien', () => expect(companySalePrice({ revenue: 5_000, cost: 6_000 }, 3, cfg)).toBe(0n));
  it('les ventes automatiques sont proportionnelles au nombre de salariés et de séances', () => {
    expect(autoSale(act, 1, 1, cfg)).toEqual({ gross: 3_150n, net: 1_050n });
    expect(autoSale(act, 2, 3, cfg).net).toBe(6_300n);
  });
});

describe('déclaration très en retard', () => {
  it('pénalité plafonnée (200 %) : pas d’erreur même après des années sans déclarer', () => {
    const cfg = { cnssTnsBp: 2150, amuTnsMonthly: 10_000, otrBp: 500, penaltyBpPerMonth: 1000, graceDays: 15, unregisteredFine: 25_000, maxEmployees: 8 };
    const d = computeDeclaration({ lastDeclaredMonth: -1, createdMonth: 0, today: 30 * 400, pendingRevenue: 1_000_000n }, cfg)!;
    expect(d.penalty).toBe(((d.cnss + d.amu + d.otr) * 20_000n) / 10_000n);
  });
});

describe('chiffre d’affaires des usines et sites', () => {
  it('déclaré avec l’entreprise, soumis à l’impôt OTR seulement (pas à la CNSS du dirigeant)', () => {
    const cfg = { cnssTnsBp: 2150, amuTnsMonthly: 10_000, otrBp: 500, penaltyBpPerMonth: 1000, graceDays: 15, unregisteredFine: 25_000, maxEmployees: 8 };
    const base = { lastDeclaredMonth: 0, createdMonth: 0, today: 30 * 2 + 1, pendingRevenue: 100_000n };
    const a = computeDeclaration(base, cfg)!;
    const b = computeDeclaration({ ...base, plantRevenue: 1_000_000n }, cfg)!;
    expect(b.cnss).toBe(a.cnss);
    expect(b.otr - a.otr).toBe(50_000n);
    expect(b.plantRevenue).toBe(1_000_000n);
  });
});
