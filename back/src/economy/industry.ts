// Industrie (fonctions pures) : bénéfice d'un site, offre d'un investisseur PNJ. Montants entiers en FCFA (BigInt), taux en points de base.

const BP = 10_000n;

export interface PlantLike {
  price: number;
  maxStaff: number;
  wagePerStaff: number;
  dailyRevenueBp: number;
  /** Charges fixes par jour de jeu (électricité, entretien, gardiennage), en points de base du prix : dues même sans activité. */
  fixedCostBp?: number;
  /** Eau et électricité en part de la production (points de base). */
  utilityBp?: number;
}

/** Aléas de l'activité : ventes du jour entre `swingMinBp` et `swingMaxBp` de la normale, et jours d'incident (aucune vente). */
export interface RiskLike {
  swingMinBp: number;
  swingMaxBp: number;
  /** Probabilité d'incident par jour de jeu (points de base) : panne, sécheresse, épidémie, blocage à l'export. */
  incidentBp: number;
  /** Demande du marché par jour, par rapport à la production normale (points de base) : sous 10000, une partie reste invendue. */
  demandMinBp?: number;
  demandMaxBp?: number;
}

/** Demande du marché un jour donné (points de base de la production normale). Tirage déterministe (site, jour). */
export function demandBp(siteKey: string, day: number, r: RiskLike): number {
  const lo = r.demandMinBp ?? 10_000;
  const hi = r.demandMaxBp ?? 10_000;
  return Math.round(lo + mixUnit(`${siteKey}|demand|${day}`) * (hi - lo));
}

/** Charges fixes par jour de jeu. */
export function fixedCostPerDay(p: PlantLike): bigint {
  return (BigInt(p.price) * BigInt(p.fixedCostBp ?? 0)) / BP;
}

const clampStaff = (p: PlantLike, staff: number) => Math.max(0, Math.min(staff, p.maxStaff));

/** Chiffre d'affaires par jour de jeu : ventes des produits, proportionnelles aux salariés en poste. */
export function revenuePerDay(p: PlantLike, staff: number): bigint {
  const s = clampStaff(p, staff);
  return s === 0 ? 0n : (BigInt(p.price) * BigInt(p.dailyRevenueBp) * BigInt(s)) / (BP * BigInt(p.maxStaff));
}

/** Salaires versés par jour de jeu. */
export function wagesPerDay(p: PlantLike, staff: number): bigint {
  return BigInt(clampStaff(p, staff)) * BigInt(p.wagePerStaff);
}

/**
 * Bénéfice net par jour de jeu : chiffre d'affaires de tout l'effectif (salariés non joueurs `staff` + joueurs embauchés
 * `players`), moins les salaires des non-joueurs. Les joueurs sont payés à part, par la paie mensuelle du propriétaire.
 */
export function netPerDay(p: PlantLike, staff: number, players = 0): bigint {
  // Peut être négatif : sans assez de personnel, les salaires et les charges fixes dépassent les ventes (on perd de l'argent)
  const revenue = revenuePerDay(p, staff + players);
  return revenue - wagesPerDay(p, staff) - fixedCostPerDay(p) - (revenue * BigInt(p.utilityBp ?? 0)) / BP;
}

/** Hachage bien réparti (FNV-1a puis brassage final type Murmur3) : des clés voisines donnent des tirages indépendants. */
function mixUnit(str: string): number {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Ventes d'un jour de jeu par rapport à la normale (points de base) : 0 = incident. Tirage déterministe (site, jour). */
export function dayFactorBp(siteKey: string, day: number, r: RiskLike): number {
  const u = mixUnit(`${siteKey}|risk|${day}`);
  if (u * 10_000 < r.incidentBp) return 0;
  const v = mixUnit(`${siteKey}|swing|${day}`);
  return Math.round(r.swingMinBp + v * (r.swingMaxBp - r.swingMinBp));
}

/**
 * Résultat d'une période (jours de jeu `fromDay` → `toDay`, nombres décimaux), jour par jour avec les aléas : ventes du jour
 * × facteur, moins salaires et charges fixes. Au plus `maxDays` jours. Le résultat peut être négatif (pertes).
 */
export function accrueRange(
  p: PlantLike,
  staff: number,
  players: number,
  siteKey: string,
  fromDay: number,
  toDay: number,
  r: RiskLike,
  maxDays: number,
  stock0 = 0n,
  spoilBp = 0,
  utilityBp = 0,
): { net: bigint; revenue: bigint; stock: bigint; accountedDays: number; utilities: bigint } {
  const start = Math.max(fromDay, toDay - maxDays);
  // Temps réellement compté (millièmes de jour entiers) : le reste n'est jamais perdu, il sera compté au calcul suivant
  let accountedDays = start - fromDay;
  const base = revenuePerDay(p, staff + players);
  const costs = wagesPerDay(p, staff) + fixedCostPerDay(p);
  let net = 0n;
  let revenue = 0n;
  // Eau et électricité : proportionnelles à ce qui est produit ce jour-là (rien produit = presque rien consommé)
  let utilities = 0n;
  // Stock invendu (valeur au prix normal) : surproduction des jours de faible demande, écoulée les jours de forte demande
  let stock = stock0 < 0n ? 0n : stock0;
  for (let d = Math.floor(start); d < toDay; d++) {
    const seg = Math.min(d + 1, toDay) - Math.max(d, start);
    if (seg <= 0) continue;
    const milli = BigInt(Math.floor(seg * 1000));
    accountedDays += Number(milli) / 1000;
    const produced = (((base * BigInt(dayFactorBp(siteKey, d, r))) / BP) * milli) / 1000n;
    const capacity = (((base * BigInt(demandBp(siteKey, d, r))) / BP) * milli) / 1000n;
    const soldNow = produced < capacity ? produced : capacity;
    const room = capacity - soldNow;
    const fromStock = stock < room ? stock : room;
    stock = stock + (produced - soldNow) - fromStock;
    // Le stock se déprécie (produits frais qui s'abîment, invendus qui vieillissent)
    stock -= (stock * BigInt(Math.round(spoilBp * seg))) / BP;
    const sold = soldNow + fromStock;
    const power = (produced * BigInt(utilityBp)) / BP;
    utilities += power;
    revenue += sold;
    net += sold - (costs * milli) / 1000n - power;
  }
  return { net, revenue, stock, accountedDays, utilities };
}

/**
 * Braderie du stock invendu : plus la remise est forte, plus on en écoule (10 % de remise → 25 % du stock, 40 % et plus →
 * tout). Renvoie la part vendue (valeur au prix normal) et l'argent encaissé (après remise).
 */
export function clearance(stock: bigint, discountBp: number): { sold: bigint; proceeds: bigint } {
  if (stock <= 0n) return { sold: 0n, proceeds: 0n };
  const shareBp = BigInt(Math.min(10_000, Math.round((discountBp * 25) / 10)));
  const sold = (stock * shareBp) / BP;
  return { sold, proceeds: (sold * BigInt(10_000 - discountBp)) / BP };
}

/** Rendement quotidien du site (intérêts nets par jour de jeu), en points de base de son prix. */
export function dailyReturnBp(p: PlantLike, staff: number, players = 0): number {
  return p.price > 0 ? Number((netPerDay(p, staff, players) * BP) / BigInt(p.price)) : 0;
}

/** Bénéfice accumulé sur une durée en jours de jeu (millièmes de jour entiers), plafonné à `maxDays` jours de bénéfice. */
export function accruedNet(net: bigint, elapsedGameDays: number, maxDays: number): bigint {
  const milli = BigInt(Math.max(0, Math.floor(Math.min(elapsedGameDays, maxDays) * 1000)));
  return (net * milli) / 1000n;
}

const hashUnit = (s: string) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
};

/** Valorisation du site selon un investisseur, un jour donné : prix × offre, variant de ±15 % selon le jour (même valeur pour tous). */
export function investorValuation(price: bigint, offerBp: number, investorId: string, plantKey: string, day: number): bigint {
  const swing = 8_500 + Math.floor(hashUnit(`${investorId}|${plantKey}|${day}`) * 3_001); // 85 % .. 115 %
  return (price * BigInt(offerBp) * BigInt(swing)) / (BP * BP);
}

/** Somme versée au propriétaire pour une part du capital (points de base de la valorisation). */
export function stakePrice(valuation: bigint, shareBp: number): bigint {
  return (valuation * BigInt(shareBp)) / BP;
}

/** Part du bénéfice qui revient à l'investisseur. */
export function investorCut(amount: bigint, shareBp: number): bigint {
  return (amount * BigInt(shareBp)) / BP;
}

/**
 * Part de la production dépensée en eau et en électricité, selon les équipements du site : le forage remplace l'eau du réseau
 * (économie `waterSaveBp`) mais sa pompe consomme de l'électricité (`pumpPowerBp` de l'eau économisée) ; l'installation solaire
 * réduit toute l'électricité, pompe comprise (`powerSaveBp`).
 */
export function utilityShare(
  base: { waterBp: number; powerBp: number },
  equip: { borehole: boolean; solar: boolean; boreholeEffBp?: number; solarEffBp?: number },
  cfg: { waterSaveBp: number; pumpPowerBp: number; powerSaveBp: number },
): { waterBp: number; powerBp: number; totalBp: number } {
  // Efficacité selon l'entretien (10000 = à neuf, 0 = en panne)
  const bEff = equip.boreholeEffBp ?? 10_000;
  const sEff = equip.solarEffBp ?? 10_000;
  const saved = equip.borehole ? Math.round((base.waterBp * cfg.waterSaveBp * bEff) / 100_000_000) : 0;
  const waterBp = base.waterBp - saved;
  const pump = Math.round((saved * cfg.pumpPowerBp) / 10_000);
  const power = base.powerBp + pump;
  const powerBp = equip.solar ? power - Math.round((power * cfg.powerSaveBp * sEff) / 100_000_000) : power;
  return { waterBp, powerBp, totalBp: waterBp + powerBp };
}

/** Prix d'un équipement selon la taille du site : part du prix du site, jamais sous le minimum. */
export function equipmentPrice(sitePrice: number, priceBp: number, minPrice: number): bigint {
  const p = (BigInt(sitePrice) * BigInt(priceBp)) / BP;
  return p > BigInt(minPrice) ? p : BigInt(minPrice);
}

/** Efficacité d'un équipement selon son entretien : à neuf jusqu'à l'échéance, moitié en retard, en panne au-delà du double du délai. */
export function maintenanceEffBp(daysSinceService: number, everyDays: number): number {
  if (daysSinceService <= everyDays) return 10_000;
  if (daysSinceService <= everyDays * 2) return 5_000;
  return 0;
}

/**
 * Panne d'un équipement : premier jour de jeu (depuis le dernier entretien ou la dernière réparation) où il tombe en panne, ou null.
 * Risque `chanceBp` par jour, multiplié par 4 quand l'entretien est en retard. Tirage déterministe (clé secrète du site, équipement, jour).
 */
export function breakdownDay(key: string, kind: string, sinceDay: number, today: number, everyDays: number, chanceBp: number): number | null {
  if (chanceBp <= 0) return null;
  const start = Math.floor(sinceDay) + 1;
  for (let d = start; d <= Math.floor(today); d++) {
    const late = d - sinceDay > everyDays;
    if (mixUnit(`${key}|${kind}|break|${d}`) * 10_000 < (late ? chanceBp * 4 : chanceBp)) return d;
  }
  return null;
}

/** Variation d'un coût (entretien, réparation) selon le site et le jour : entre `minBp` et `maxBp` du prix de base. Déterministe. */
export function costSwingBp(key: string, label: string, day: number, minBp = 7_000, maxBp = 13_000): number {
  return Math.round(minBp + mixUnit(`${key}|cost|${label}|${Math.floor(day)}`) * (maxBp - minBp));
}
