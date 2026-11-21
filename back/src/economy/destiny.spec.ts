import { describe, expect, it } from 'vitest';
import { conditionAvailability, settleDestiny, type ConditionQuota } from './destiny';

const quota: { RICH: ConditionQuota; MIDDLE: ConditionQuota } = { RICH: { maxShareBp: 1000, minSlots: 2 }, MIDDLE: { maxShareBp: 6000, minSlots: 5 } };

describe('conditionAvailability', () => {
  it('jeu vide : les places minimales sont ouvertes', () => {
    expect(conditionAvailability({ RICH: 0, MIDDLE: 0, POOR: 0 }, quota)).toEqual({ RICH: true, MIDDLE: true, POOR: true });
  });
  it('plancher de places : deux riches même avec peu de joueurs, pas trois', () => {
    expect(conditionAvailability({ RICH: 1, MIDDLE: 0, POOR: 3 }, quota).RICH).toBe(true);
    expect(conditionAvailability({ RICH: 2, MIDDLE: 0, POOR: 3 }, quota).RICH).toBe(false);
  });
  it('proportionnel : 10 % de riches maximum sur 100 personnages', () => {
    expect(conditionAvailability({ RICH: 9, MIDDLE: 40, POOR: 51 }, quota).RICH).toBe(true); // 10 / 101 = 9,9 %
    expect(conditionAvailability({ RICH: 10, MIDDLE: 40, POOR: 50 }, quota).RICH).toBe(false); // 11 / 101 = 10,9 %
  });
  it('la place se rouvre quand l\'effectif grandit', () => {
    expect(conditionAvailability({ RICH: 10, MIDDLE: 40, POOR: 50 }, quota).RICH).toBe(false);
    expect(conditionAvailability({ RICH: 10, MIDDLE: 45, POOR: 55 }, quota).RICH).toBe(true); // 11 / 111
  });
  it('la condition pauvre n\'est jamais bloquée', () => {
    expect(conditionAvailability({ RICH: 50, MIDDLE: 50, POOR: 0 }, quota).POOR).toBe(true);
  });
  it('moyen est plafonné à 60 %', () => {
    expect(conditionAvailability({ RICH: 5, MIDDLE: 60, POOR: 35 }, quota).MIDDLE).toBe(false);
    expect(conditionAvailability({ RICH: 5, MIDDLE: 50, POOR: 45 }, quota).MIDDLE).toBe(true);
  });
  it('un plafond à 0 % ferme la condition une fois le plancher atteint', () => {
    const closed = { RICH: { maxShareBp: 0, minSlots: 0 }, MIDDLE: quota.MIDDLE };
    expect(conditionAvailability({ RICH: 0, MIDDLE: 0, POOR: 0 }, closed).RICH).toBe(false);
  });
});

describe('settleDestiny', () => {
  it('garde le tirage s\'il est disponible', () => {
    expect(settleDestiny('RICH', { RICH: true, MIDDLE: true, POOR: true })).toBe('RICH');
  });
  it('descend d\'un cran quand la condition est complète', () => {
    expect(settleDestiny('RICH', { RICH: false, MIDDLE: true, POOR: true })).toBe('MIDDLE');
    expect(settleDestiny('RICH', { RICH: false, MIDDLE: false, POOR: true })).toBe('POOR');
    expect(settleDestiny('MIDDLE', { RICH: true, MIDDLE: false, POOR: true })).toBe('POOR');
  });
});
