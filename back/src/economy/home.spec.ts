import { describe, expect, it } from 'vitest';
import { halfFootprint, insideRoom, overlaps, resalePrice, standingOf, type FurnitureDef } from './home';

const sofa: FurnitureDef = { id: 'canape', w: 2.2, d: 0.95, comfort: 12 };
const rug: FurnitureDef = { id: 'tapis', w: 2, d: 1.4, comfort: 4, flat: true };
const room = { w: 7, d: 7 };

describe('aménagement du logement', () => {
  it("la rotation impaire échange largeur et profondeur", () => {
    expect(halfFootprint(sofa, 0)).toEqual({ hw: 1.1, hd: 0.475 });
    expect(halfFootprint(sofa, 1)).toEqual({ hw: 0.475, hd: 1.1 });
  });
  it('refuse un meuble qui sort de la pièce, accepte celui qui tient', () => {
    expect(insideRoom(sofa, { x: 0, z: 0, rot: 0 }, room)).toBe(true);
    expect(insideRoom(sofa, { x: 3, z: 0, rot: 0 }, room)).toBe(false);
    expect(insideRoom(sofa, { x: 2.2, z: 0, rot: 1 }, room)).toBe(true);
    expect(insideRoom(sofa, { x: 0, z: 3.4, rot: 0 }, room)).toBe(false);
  });
  it('détecte les chevauchements, sauf les tapis', () => {
    const a = { def: sofa, p: { itemId: 'canape', x: 0, z: 0, rot: 0 } };
    expect(overlaps(a, { def: sofa, p: { itemId: 'canape', x: 1, z: 0.5, rot: 0 } })).toBe(true);
    expect(overlaps(a, { def: sofa, p: { itemId: 'canape', x: 0, z: 1.2, rot: 0 } })).toBe(false);
    expect(overlaps(a, { def: rug, p: { itemId: 'tapis', x: 0, z: 0, rot: 0 } })).toBe(false);
  });
  it('revente et standing', () => {
    expect(resalePrice(180_000, 6_000)).toBe(108_000);
    expect(resalePrice(15_001, 6_000)).toBe(9_000);
    const th = { comfortable: 40, luxurious: 120 };
    expect([standingOf(0, th), standingOf(40, th), standingOf(120, th)]).toEqual(['MODEST', 'COMFORTABLE', 'LUXURIOUS']);
  });
});
