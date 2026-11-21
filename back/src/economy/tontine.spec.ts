import { describe, expect, it } from 'vitest';
import { deadlineOf, drawTurns, roundAt, settleRound } from './tontine';

describe('tontine', () => {
  it('calcule le tour en cours et son échéance', () => {
    expect(roundAt(10, 7, 10)).toBe(0);
    expect(roundAt(10, 7, 16)).toBe(0);
    expect(roundAt(10, 7, 17)).toBe(1);
    expect(roundAt(10, 7, 5)).toBe(0);
    expect(deadlineOf(10, 7, 0)).toBe(17);
    expect(deadlineOf(10, 7, 2)).toBe(31);
  });

  it('tire un ordre qui est une permutation', () => {
    let s = 7;
    const r = drawTurns(['a', 'b', 'c', 'd'], (n) => (s = (s * 31 + 3) % 97) % n);
    expect([...r].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  const members = [
    { id: 'a', turn: 0, missedBefore: 0, present: true },
    { id: 'b', turn: 1, missedBefore: 0, present: true },
    { id: 'c', turn: 2, missedBefore: 0, present: true },
  ];

  it('verse toute la caisse au bénéficiaire du tour', () => {
    const r = settleRound({ members, round: 1, paid: [{ memberId: 'a', amount: 5000n }, { memberId: 'b', amount: 5000n }, { memberId: 'c', amount: 5000n }] });
    expect(r.payout).toEqual({ kind: 'beneficiary', to: 'b', amount: 15000n });
    expect(r.missing).toEqual([]);
  });

  it('signale les défaillants mais paie quand même le bénéficiaire en règle', () => {
    const r = settleRound({ members, round: 0, paid: [{ memberId: 'a', amount: 5000n }, { memberId: 'b', amount: 5000n }] });
    expect(r.missing).toEqual(['c']);
    expect(r.payout).toEqual({ kind: 'beneficiary', to: 'a', amount: 10000n });
  });

  it('rembourse les cotisants si le bénéficiaire a manqué une cotisation ou est parti', () => {
    const late = members.map((m) => (m.id === 'c' ? { ...m, missedBefore: 1 } : m));
    const r = settleRound({ members: late, round: 2, paid: [{ memberId: 'a', amount: 5000n }, { memberId: 'b', amount: 5000n }, { memberId: 'c', amount: 5000n }] });
    expect(r.payout).toEqual({ kind: 'refund', to: [{ member: 'a', amount: 5000n }, { member: 'b', amount: 5000n }, { member: 'c', amount: 5000n }] });
    const gone = members.map((m) => (m.id === 'a' ? { ...m, present: false } : m));
    expect(settleRound({ members: gone, round: 0, paid: [{ memberId: 'b', amount: 5000n }] }).payout.kind).toBe('refund');
  });

  it('ne verse rien quand personne n’a cotisé', () => {
    expect(settleRound({ members, round: 0, paid: [] }).payout).toEqual({ kind: 'none' });
  });
});
