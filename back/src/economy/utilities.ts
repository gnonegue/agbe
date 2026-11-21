// Factures d'électricité (fonctions pures) : consommation selon le logement, ses appareils et l'usage, facturée par tranches
// comme à la CEET (le kWh des premières tranches est moins cher). Montants entiers en FCFA.

export interface PowerTranche {
  /** Borne haute de la tranche en kWh par mois (null = sans limite). */
  upToKwh: number | null;
  /** Prix du kWh dans la tranche. */
  price: number;
}

/** Coût de l'énergie consommée, tranche par tranche. */
export function energyCost(kwh: number, tranches: readonly PowerTranche[]): number {
  let rest = Math.max(0, Math.floor(kwh));
  let prev = 0;
  let cost = 0;
  for (const t of tranches) {
    if (rest <= 0) break;
    const width = t.upToKwh === null ? rest : Math.max(0, t.upToKwh - prev);
    const used = Math.min(rest, width);
    cost += used * t.price;
    rest -= used;
    if (t.upToKwh !== null) prev = t.upToKwh;
  }
  return cost;
}

export interface PowerUse {
  /** Éclairage et petits appareils du logement (kWh par mois). */
  baseKwh: number;
  /** Appareils installés (meubles du logement, appareils de cuisine) : kWh par mois chacun. */
  appliancesKwh: number;
  /** Cuissons au réchaud électrique depuis la dernière facture (compteur, en kWh). */
  cookingKwh: number;
  /** Panneaux solaires : part de la consommation couverte (points de base), 0 sans panneaux. */
  solarBp: number;
}

/** Facture d'électricité du mois : abonnement + énergie consommée (après les panneaux solaires) par tranches. */
export function powerBill(use: PowerUse, subscription: number, tranches: readonly PowerTranche[]): { kwh: number; solarKwh: number; energy: number; subscription: number; total: number } {
  const gross = Math.max(0, use.baseKwh + use.appliancesKwh + use.cookingKwh);
  const solarKwh = Math.floor((gross * Math.min(10_000, Math.max(0, use.solarBp))) / 10_000);
  const kwh = gross - solarKwh;
  const energy = energyCost(kwh, tranches);
  return { kwh, solarKwh, energy, subscription, total: subscription + energy };
}

export interface WaterTranche {
  /** Borne haute de la tranche en m³ par mois (null = sans limite). */
  upToM3: number | null;
  /** Prix du m³ dans la tranche. */
  price: number;
}

/** Coût de l'eau consommée (en litres), tranche par tranche (prix au m³), arrondi au franc. */
export function waterCost(litres: number, tranches: readonly WaterTranche[]): number {
  let rest = Math.max(0, Math.floor(litres));
  let prev = 0;
  let cost = 0;
  for (const t of tranches) {
    if (rest <= 0) break;
    const width = t.upToM3 === null ? rest : Math.max(0, t.upToM3 * 1000 - prev);
    const used = Math.min(rest, width);
    cost += used * t.price;
    rest -= used;
    if (t.upToM3 !== null) prev = t.upToM3 * 1000;
  }
  return Math.round(cost / 1000);
}

/** Facture d'eau du mois : abonnement + eau consommée (logement, douches, cuisine) par tranches de m³. */
export function waterBill(use: { baseLitres: number; showers: number; showerLitres: number; cookingLitres: number }, subscription: number, tranches: readonly WaterTranche[]): { litres: number; showerLitres: number; water: number; subscription: number; total: number } {
  const showerLitres = Math.max(0, use.showers) * Math.max(0, use.showerLitres);
  const litres = Math.max(0, use.baseLitres) + showerLitres + Math.max(0, use.cookingLitres);
  const water = waterCost(litres, tranches);
  return { litres, showerLitres, water, subscription, total: subscription + water };
}
