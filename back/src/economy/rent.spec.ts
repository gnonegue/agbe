import { describe, expect, it } from 'vitest';
import { arrearsTotal, downgrade, nextRentPayment, overdueMonths } from './rent';

describe('loyer en retard', () => {
  it('compte les mois entamés', () => {
    expect(overdueMonths(30, 30)).toBe(0);
    expect(overdueMonths(30, 31)).toBe(1);
    expect(overdueMonths(30, 60)).toBe(1);
    expect(overdueMonths(30, 61)).toBe(2);
  });
  it('majore de 1 % par jour de retard', () => {
    expect(nextRentPayment(25_000n, 30, 30, 100)).toBe(25_000n);
    expect(nextRentPayment(25_000n, 30, 31, 100)).toBe(25_250n);
    expect(nextRentPayment(25_000n, 30, 40, 100)).toBe(27_500n);
    // 65 jours après l'échéance : 3 mois dus, en retard de 65, 35 et 5 jours
    expect(arrearsTotal(25_000n, 0, 65, 100)).toBe(41_250n + 33_750n + 26_250n);
  });
  it('descend d’un niveau, puis à la rue', () => {
    expect(downgrade('VILLA')).toBe('CHAMBRE_SALON');
    expect(downgrade('CHAMBRE_SALON')).toBe('ENTRER_COUCHER');
    expect(downgrade('ENTRER_COUCHER')).toBeNull();
  });
});
