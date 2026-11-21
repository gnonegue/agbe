// Investissements du jeu (fonctions pures) : cours de bourse simulés et revenus des placements.
// Simulation de jeu sans lien avec de vrais marchés ; montants entiers, taux en points de base.

const fnv = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

/** Valeur pseudo-aléatoire bien mélangée dans [-1, 1] pour le couple (graine, entier). */
const lattice = (seed: number, i: number) => {
  let h = (seed ^ Math.imul(i | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
};

/** Bruit lisse : interpolation en cosinus entre deux points du réseau. */
const smooth = (seed: number, x: number) => {
  const i = Math.floor(x);
  const w = (1 - Math.cos((x - i) * Math.PI)) / 2;
  return lattice(seed, i) * (1 - w) + lattice(seed, i + 1) * w;
};

/** Cycles superposés, en jours de jeu : remous de quelques heures jusqu'aux grandes tendances de plusieurs années. */
const PERIODS = [0.25, 1, 4, 15, 60, 240, 900];

/** Écart (logarithmique) au prix de référence, avant normalisation. */
function swing(symbol: string, volBp: number, t: number): number {
  const seed = fnv(symbol);
  const vol = volBp / 10_000;
  const cap = Math.min(0.3, vol * 15);
  let v = 0;
  PERIODS.forEach((P, k) => {
    const amp = Math.min(vol * Math.sqrt(P) * 0.9, cap);
    v += amp * smooth(lattice(seed, k + 1) * 2 ** 31 >>> 0, t / P + k * 0.37);
  });
  return v;
}

/** Tendance de fond : croissance (ou déclin) lente qui s'essouffle avec le temps, bornée à ±70 % en log. */
function trend(driftBp: number, t: number): number {
  const g = (driftBp / 10_000) * 40 * Math.log(1 + Math.max(0, t) / 40);
  return Math.max(-0.7, Math.min(0.7, g));
}

/**
 * Cours d'une action au temps de jeu « t » (en jours, fraction comprise : le cours bouge à chaque heure de jeu).
 * Même cours pour tous les joueurs. Le cours oscille autour du prix de référence `base` (cycles courts et longs,
 * amplitude réglée par `volBp`, variation quotidienne moyenne ≈ 60 % de `volBp`) et suit une tendance de fond lente
 * réglée par `driftBp`. Il reste borné : il peut chuter puis remonter, jamais exploser ni rester collé au plancher.
 * Arrondi à 5 FCFA, plancher à 5.
 */
export function stockPrice(symbol: string, base: number, driftBp: number, volBp: number, t: number): number {
  const x = trend(driftBp, t) + swing(symbol, volBp, t) - swing(symbol, volBp, 0);
  return Math.max(5, Math.round((base * Math.exp(x)) / 5) * 5);
}

/** Cours de clôture des « n » derniers jours jusqu'au jour « day » (pour les mini-graphiques et les rappels). */
export function stockSeries(symbol: string, base: number, driftBp: number, volBp: number, day: number, n: number): number[] {
  const out: number[] = [];
  for (let d = Math.max(0, day - n + 1); d <= day; d++) out.push(stockPrice(symbol, base, driftBp, volBp, d));
  return out;
}

/** Périodes d'observation proposées au joueur : durée en jours de jeu et pas entre deux points (en jours). */
export const STOCK_RANGES = { '1d': [1, 1 / 24], '7d': [7, 2 / 24], '30d': [30, 0.25], '90d': [90, 1], '1y': [365, 1], '5y': [1825, 5] } as const;
export type StockRange = keyof typeof STOCK_RANGES;

/** Historique d'un cours sur une période, se terminant à « t » (temps de jeu en jours) ; jamais avant le jour 0. */
export function stockHistory(symbol: string, base: number, driftBp: number, volBp: number, t: number, range: StockRange): { t: number; p: number }[] {
  const [span, step] = STOCK_RANGES[range];
  const out: { t: number; p: number }[] = [];
  const from = Math.max(0, t - span);
  const n = Math.round((t - from) / step);
  for (let i = 0; i <= n; i++) {
    const at = Math.max(from, t - (n - i) * step);
    out.push({ t: Math.round(at * 24) / 24, p: stockPrice(symbol, base, driftBp, volBp, at) });
  }
  return out;
}

/** Revenu cumulé d'une seconde activité : linéaire sur les jours actifs (arrêt à l'échec éventuel). */
export function accrued(total: bigint, totalDays: number, elapsedDays: number, activeDays: number): bigint {
  if (totalDays <= 0) return total;
  const d = Math.max(0, Math.min(elapsedDays, activeDays, totalDays));
  return (total * BigInt(Math.floor(d))) / BigInt(totalDays);
}

/** Intérêts simples d'un compte épargne pour « days » jours (arrondis au franc inférieur). */
export function savingsInterest(balance: bigint, dailyBp: number, days: number): bigint {
  if (balance <= 0n || days <= 0 || dailyBp <= 0) return 0n;
  return (balance * BigInt(dailyBp) * BigInt(days)) / 10_000n;
}
