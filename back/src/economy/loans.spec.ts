import { describe, expect, it } from 'vitest';
import { loanAmountWithPenalty, loanDueNow, loanInstallment, loanLatePenalty, loanRemainingAfterRepay, loanTotalDue } from './loans';

describe('prêt bancaire personnel', () => {
  it('total dû = capital + intérêts simples sur la durée', () => {
    // 1 000 000 FCFA à 18 %/an sur 360 jours de jeu (année complète) = +180 000
    expect(loanTotalDue(1_000_000n, 1_800, 360)).toBe(1_180_000n);
  });

  it('mensualité fixe arrondie au FCFA supérieur', () => {
    expect(loanInstallment(1_180_000n, 12)).toBe(98_334n); // 1180000/12 = 98333.33…
    expect(loanInstallment(1_200_000n, 12)).toBe(100_000n);
  });

  it('dernier versement plafonné au solde restant', () => {
    expect(loanDueNow(100_000n, 98_334n)).toBe(98_334n);
    expect(loanDueNow(50_000n, 98_334n)).toBe(50_000n);
  });

  it('pénalité de retard bornée', () => {
    expect(loanLatePenalty(100_000n, 0, 50)).toBe(0n);
    expect(loanLatePenalty(100_000n, 10, 50)).toBe(5_000n); // 0,5 %/jour × 10 jours = 5 %
    // bornée à 50 % même avec un retard énorme
    expect(loanLatePenalty(100_000n, 100_000, 50)).toBe(50_000n);
    expect(loanAmountWithPenalty(100_000n, 10, 50)).toBe(105_000n);
  });

  it('capital restant après remboursement, jamais négatif', () => {
    expect(loanRemainingAfterRepay(100_000n, 30_000n)).toBe(70_000n);
    expect(loanRemainingAfterRepay(100_000n, 150_000n)).toBe(0n);
  });
});
