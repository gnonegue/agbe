// Calculs purs des véhicules personnels (moto, voiture) : carburant, usure, condition, pannes, revente.
// Tout est en entiers : millilitres, mètres, points de base, FCFA.

export interface VehicleModel {
  id: string;
  kind: 'MOTO' | 'CAR';
  price: number;
  tankL: number;
  /** Consommation en millilitres par kilomètre. */
  mlPerKm: number;
  serviceEveryKm: number;
  serviceCost: number;
  repairCost: number;
}

export interface VehicleRules {
  minCondition: number;
  breakdownBpPerOverdue: number;
  breakdownDamage: number;
}

export interface VehicleState {
  fuelMl: number;
  odometerM: number;
  sinceServiceM: number;
  damage: number;
  boughtPrice: number;
}

/** Carburant nécessaire (ml) pour parcourir `meters` mètres, arrondi au ml supérieur. */
export function fuelNeededMl(meters: number, model: Pick<VehicleModel, 'mlPerKm'>): number {
  return Math.ceil((meters * model.mlPerKm) / 1000);
}

/** Capacité du réservoir en millilitres. */
export const tankMl = (model: Pick<VehicleModel, 'tankL'>): number => model.tankL * 1000;

/**
 * Condition (0-100) : 100 à neuf ; l'usure fait perdre 40 points sur un intervalle d'entretien et 100 points à 2,5 intervalles ;
 * les dégâts (pannes, accidents) se retranchent en plus et ne partent qu'à la réparation.
 */
export function condition(state: Pick<VehicleState, 'sinceServiceM' | 'damage'>, model: Pick<VehicleModel, 'serviceEveryKm'>): number {
  const wear = Math.floor((100 * state.sinceServiceM) / (model.serviceEveryKm * 1000 * 2.5));
  return Math.max(0, 100 - Math.min(100, wear) - state.damage);
}

/** Part d'entretien dépassé (0 si l'entretien n'est pas encore dû) : 1 = un intervalle entier de retard. */
export function overdueRatioBp(sinceServiceM: number, model: Pick<VehicleModel, 'serviceEveryKm'>): number {
  const due = model.serviceEveryKm * 1000;
  return sinceServiceM <= due ? 0 : Math.floor(((sinceServiceM - due) * 10_000) / due);
}

/** Risque de panne (pb) sur un trajet : nul tant que l'entretien n'est pas dépassé, puis proportionnel au retard (plafonné à 60 %). */
export function breakdownRiskBp(sinceServiceM: number, model: Pick<VehicleModel, 'serviceEveryKm'>, rules: Pick<VehicleRules, 'breakdownBpPerOverdue'>): number {
  return Math.min(6_000, Math.floor((overdueRatioBp(sinceServiceM, model) * rules.breakdownBpPerOverdue) / 10_000));
}

/** Valeur de revente en FCFA : part du prix payé qui diminue avec le kilométrage, jamais sous le plancher ; les dégâts la réduisent. */
export function resaleValue(state: VehicleState, resale: { startBp: number; lossBpPerKm: number; floorBp: number }): number {
  const km = Math.floor(state.odometerM / 1000);
  const bp = Math.max(resale.floorBp, resale.startBp - km * resale.lossBpPerKm);
  const gross = Math.floor((state.boughtPrice * bp) / 10_000);
  return Math.max(0, Math.floor((gross * (100 - Math.min(60, state.damage))) / 100));
}

/** Prix du litre livré à distance : prix du jour majoré de `surchargeBp` (arrondi au franc supérieur). */
export function remoteLitrePrice(perL: number, surchargeBp: number): number {
  return Math.ceil((perL * (10_000 + surchargeBp)) / 10_000);
}
