import { describe, expect, it } from 'vitest';
import { sleepGameHours } from './sleep';

const R = { fromHour: 20, wakeHour: 6, minGameHours: 6, maxGameHours: 8 };

describe('sleepGameHours', () => {
  it('dort jusqu’au réveil, entre 6 h et 8 h', () => {
    expect(sleepGameHours(21 * 60 + 30, R)).toBe(8);
    expect(sleepGameHours(23 * 60, R)).toBe(7);
    expect(sleepGameHours(2 * 60, R)).toBe(6);
    expect(sleepGameHours(20 * 60, R)).toBe(8);
  });
  it('pas de nuit en journée', () => {
    expect(sleepGameHours(6 * 60, R)).toBeNull();
    expect(sleepGameHours(14 * 60, R)).toBeNull();
    expect(sleepGameHours(19 * 60 + 59, R)).toBeNull();
  });
});
