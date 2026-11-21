import { describe, expect, it } from 'vitest';
import { fits, outfitError, shopPrices, type GarmentLike } from './clothes';

const catalog: GarmentLike[] = [
  { id: 'polo', slot: 'top', gender: 'm', price: 5_000 },
  { id: 'blouse', slot: 'top', gender: 'f', price: 6_000 },
  { id: 'jean', slot: 'bottom', gender: 'u', price: 8_000 },
  { id: 'robe', slot: 'dress', gender: 'f', price: 12_000 },
  { id: 'baskets', slot: 'shoes', gender: 'u', price: 10_000 },
];
const owned = new Set(['polo', 'blouse', 'jean', 'robe', 'baskets']);

describe('tenue portée', () => {
  it('accepte un haut et un bas, avec ou sans chaussures', () => {
    expect(outfitError({ top: 'polo', bottom: 'jean' }, catalog, owned, false)).toBeNull();
    expect(outfitError({ top: 'polo', bottom: 'jean', shoes: 'baskets' }, catalog, owned, false)).toBeNull();
  });
  it('accepte une robe seule, mais pas avec un haut ou un bas', () => {
    expect(outfitError({ dress: 'robe', shoes: 'baskets' }, catalog, owned, true)).toBeNull();
    expect(outfitError({ dress: 'robe', bottom: 'jean' }, catalog, owned, true)).toBe('dress_with_separates');
  });
  it('exige le haut et le bas sans robe', () => {
    expect(outfitError({ top: 'polo' }, catalog, owned, false)).toBe('outfit_incomplete');
    expect(outfitError({}, catalog, owned, false)).toBe('outfit_incomplete');
  });
  it('refuse une pièce inconnue, non possédée, mal placée ou de l’autre coupe', () => {
    expect(outfitError({ top: 'cape', bottom: 'jean' }, catalog, owned, false)).toBe('unknown_garment');
    expect(outfitError({ top: 'polo', bottom: 'jean' }, catalog, new Set(['jean']), false)).toBe('garment_not_owned');
    expect(outfitError({ top: 'jean', bottom: 'jean' }, catalog, owned, false)).toBe('wrong_slot');
    expect(outfitError({ top: 'blouse', bottom: 'jean' }, catalog, owned, false)).toBe('garment_wrong_gender');
    expect(outfitError({ dress: 'robe' }, catalog, owned, false)).toBe('garment_wrong_gender');
  });
  it('distingue les coupes homme, femme et mixtes', () => {
    expect(fits({ gender: 'u' }, true)).toBe(true);
    expect(fits({ gender: 'm' }, true)).toBe(false);
    expect(fits({ gender: 'f' }, true)).toBe(true);
  });
});

describe('prix des boutiques de vêtements', () => {
  it('achète en gros à 60 % et revend entre le prix de gros et 150 % du prix public', () => {
    expect(shopPrices(10_000, 6_000, 15_000)).toEqual({ wholesale: 6_000, min: 6_000, max: 15_000 });
  });
  it('ne descend jamais sous 1 FCFA et garde un maximum au moins égal au prix de gros', () => {
    expect(shopPrices(1, 100, 100)).toEqual({ wholesale: 1, min: 1, max: 1 });
  });
});

import { closeQuote, npcDemandBp } from './clothes';
describe('boutique : fermeture et clients du quartier', () => {
  it('rachète le stock à la moitié du prix de gros et rembourse la moitié du loyer non consommé', () => {
    const q = closeQuote([{ qty: 10, wholesale: 6_000 }, { qty: 2, wholesale: 1_500 }], 14, 7_000, 5_000, 5_000);
    expect(q.buyback).toBe(31_500n); // (60 000 + 3 000) × 50 %
    expect(q.refund).toBe(7_000n); // 2 semaines = 14 000 × 50 %
    expect(closeQuote([], 0, 7_000, 5_000, 5_000)).toEqual({ buyback: 0n, refund: 0n });
  });
  it("l'appétit des clients baisse avec le prix et s'annule à 140 % du prix public", () => {
    expect(npcDemandBp(6_000, 10_000)).toBe(8_000);
    expect(npcDemandBp(10_000, 10_000)).toBe(4_000);
    expect(npcDemandBp(12_000, 10_000)).toBe(2_000);
    expect(npcDemandBp(14_000, 10_000)).toBe(0);
    expect(npcDemandBp(20_000, 10_000)).toBe(0);
  });
});
