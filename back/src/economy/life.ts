// Vie quotidienne (fonctions pures) : maladie, demandes de la famille, coupures. Un appel = un jour de jeu.
import type { Needs } from './needs';

export type Rand = (maxExclusive: number) => number;
type Condition = 'POOR' | 'MIDDLE' | 'RICH';

export interface Illness {
  id: string;
  weight: number;
  dailyHealth: number;
  dailyEnergy: number;
  selfHealDays: number;
}
export interface HealthRules {
  dailyRiskBp: number;
  dirtyBelow: number;
  dirtyMultiplierBp: number;
  weakBelow: number;
  weakMultiplierBp: number;
}

/** Risque du jour (points de base) : hygiène et santé basses le multiplient, plafonné à 100 %. */
export function illnessRiskBp(needs: Pick<Needs, 'hygiene' | 'health'>, r: HealthRules): number {
  let risk = r.dailyRiskBp;
  if (needs.hygiene < r.dirtyBelow) risk = Math.round((risk * r.dirtyMultiplierBp) / 10_000);
  if (needs.health < r.weakBelow) risk = Math.round((risk * r.weakMultiplierBp) / 10_000);
  return Math.min(10_000, risk);
}

/** Tirage pondéré ; null si tous les poids sont nuls. */
export function pickWeighted<T extends { weight: number }>(items: readonly T[], rand: Rand): T | null {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (total <= 0) return null;
  let x = rand(total);
  for (const i of items) {
    x -= Math.max(0, i.weight);
    if (x < 0) return i;
  }
  return null;
}

/** Vrai avec une probabilité de `bp` sur 10 000. */
export const chance = (bp: number, rand: Rand) => bp > 0 && rand(10_000) < bp;

export interface DayResult {
  /** Variation des besoins due à la maladie. */
  effects: Partial<Needs>;
  /** Maladie après ce jour (null : guéri ou en bonne santé). */
  illness: { id: string; day: number } | null;
  /** Maladie déclarée ce jour. */
  fellIll: string | null;
  healed: boolean;
}

/** Un jour de maladie : aggravation, guérison spontanée éventuelle, ou risque d'en attraper une. */
export function illnessDay(input: { day: number; needs: Pick<Needs, 'hygiene' | 'health'>; current: { id: string; day: number } | null }, illnesses: readonly Illness[], rules: HealthRules, rand: Rand): DayResult {
  const cur = input.current ? illnesses.find((i) => i.id === input.current!.id) : undefined;
  if (input.current && cur) {
    if (cur.selfHealDays > 0 && input.day - input.current.day >= cur.selfHealDays) return { effects: {}, illness: null, fellIll: null, healed: true };
    return { effects: { health: -cur.dailyHealth, energy: -cur.dailyEnergy }, illness: input.current, fellIll: null, healed: false };
  }
  if (input.current && !cur) return { effects: {}, illness: null, fellIll: null, healed: true }; // maladie retirée du réglage
  if (!chance(illnessRiskBp(input.needs, rules), rand)) return { effects: {}, illness: null, fellIll: null, healed: false };
  const got = pickWeighted(illnesses, rand);
  if (!got) return { effects: {}, illness: null, fellIll: null, healed: false };
  return { effects: { health: -got.dailyHealth, energy: -got.dailyEnergy }, illness: { id: got.id, day: input.day }, fellIll: got.id, healed: false };
}

/** Demande de la famille du jour (une seule en attente à la fois). */
export function familyDay(input: { condition: Condition; pending: boolean }, rules: { dailyRequestBp: number; requests: { id: string; amount: Record<Condition, number> }[] }, rand: Rand): { kind: string; amount: number } | null {
  if (input.pending || !chance(rules.dailyRequestBp, rand)) return null;
  const r = rules.requests[rand(rules.requests.length)]!;
  return { kind: r.id, amount: r.amount[input.condition] };
}

/** Aide de la famille quand le solde est très bas (coup dur). */
export function familyHelp(input: { condition: Condition; balance: bigint }, rules: { helpBelow: number; helpChanceBp: Record<Condition, number>; helpAmount: Record<Condition, number> }, rand: Rand): number {
  if (input.balance >= BigInt(rules.helpBelow)) return 0;
  return chance(rules.helpChanceBp[input.condition], rand) ? rules.helpAmount[input.condition] : 0;
}

/** Coupure du jour : durée en heures de jeu, ou 0. */
export function outageHours(dailyBp: number, range: [number, number], rand: Rand): number {
  if (!chance(dailyBp, rand)) return 0;
  const [lo, hi] = range[0] <= range[1] ? range : [range[1], range[0]];
  return lo + rand(hi - lo + 1);
}
