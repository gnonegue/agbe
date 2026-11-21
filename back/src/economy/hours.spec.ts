import { describe, expect, it } from 'vitest';
import { isOpen } from './hours';

describe('heures d’ouverture', () => {
  it('journée simple : ouvert de 7 h à 18 h', () => {
    expect(isOpen([7, 18], 6)).toBe(false);
    expect(isOpen([7, 18], 7)).toBe(true);
    expect(isOpen([7, 18], 17)).toBe(true);
    expect(isOpen([7, 18], 18)).toBe(false);
  });
  it('ouvert la nuit : maquis de 11 h à 2 h', () => {
    expect(isOpen([11, 2], 23)).toBe(true);
    expect(isOpen([11, 2], 1)).toBe(true);
    expect(isOpen([11, 2], 3)).toBe(false);
    expect(isOpen([11, 2], 10)).toBe(false);
  });
  it('toujours ouvert et lieu sans horaires', () => {
    expect(isOpen([0, 24], 3)).toBe(true);
    expect(isOpen(undefined, 3)).toBe(true);
  });
});
