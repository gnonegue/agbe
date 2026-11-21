import { describe, expect, it } from 'vitest';
import { fitsGrid, overlaps } from './plots';

describe('parcelles en mer', () => {
  it('chevauchement : intersection oui, bords jointifs non', () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 1, h: 1 })).toBe(false);
  });
  it('doit tenir dans la grille avec une taille autorisée', () => {
    expect(fitsGrid({ x: 46, y: 10, w: 2, h: 2 }, 48, 12, 8)).toBe(true);
    expect(fitsGrid({ x: 47, y: 0, w: 2, h: 1 }, 48, 12, 8)).toBe(false);
    expect(fitsGrid({ x: 0, y: 0, w: 9, h: 1 }, 48, 12, 8)).toBe(false);
    expect(fitsGrid({ x: -1, y: 0, w: 1, h: 1 }, 48, 12, 8)).toBe(false);
  });
});
