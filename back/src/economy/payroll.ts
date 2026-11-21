import { applyRate } from './money';

// Simulation de paie togolaise. Tous les taux viennent de la base (back-office), jamais du code.
// Valeurs à revérifier par un expert-comptable avant lancement.

export interface IrppBracket {
  /** Borne basse du revenu imposable mensuel (FCFA, incluse). */
  from: number;
  /** Taux marginal en points de base. */
  rateBp: number;
}

export interface PayrollRates {
  smig: number;
  cnssEmployeeBp: number;
  cnssEmployerBp: number;
  amuEmployeeBp: number;
  amuEmployerBp: number;
  /** Barème IRPP progressif (mensuel). Vide tant que le barème officiel OTR n'est pas intégré. */
  irppBrackets: IrppBracket[];
}

export interface PayrollResult {
  gross: bigint;
  amuBase: bigint;
  cnssEmployee: bigint;
  amuEmployee: bigint;
  taxable: bigint;
  irpp: bigint;
  net: bigint;
  cnssEmployer: bigint;
  amuEmployer: bigint;
  employerCost: bigint;
  belowSmig: boolean;
}

export function progressiveTax(taxable: bigint, brackets: IrppBracket[]): bigint {
  if (taxable <= 0n || brackets.length === 0) return 0n;
  const sorted = [...brackets].sort((a, b) => a.from - b.from);
  let tax = 0n;
  for (let i = 0; i < sorted.length; i++) {
    const lower = BigInt(sorted[i].from);
    const upper = i + 1 < sorted.length ? BigInt(sorted[i + 1].from) : null;
    if (taxable <= lower) break;
    const top = upper !== null && taxable > upper ? upper : taxable;
    tax += applyRate(top - lower, sorted[i].rateBp);
  }
  return tax;
}

export function computePayroll(grossInput: bigint, r: PayrollRates): PayrollResult {
  if (grossInput < 0n) throw new RangeError('gross must be >= 0');
  const gross = grossInput;
  const smig = BigInt(r.smig);
  // AMU : base minimale = SMIG.
  const amuBase = gross > smig ? gross : smig;
  const cnssEmployee = applyRate(gross, r.cnssEmployeeBp);
  const amuEmployee = applyRate(amuBase, r.amuEmployeeBp);
  const taxable = gross - cnssEmployee - amuEmployee;
  const irpp = progressiveTax(taxable > 0n ? taxable : 0n, r.irppBrackets);
  const net = gross - cnssEmployee - amuEmployee - irpp;
  const cnssEmployer = applyRate(gross, r.cnssEmployerBp);
  const amuEmployer = applyRate(amuBase, r.amuEmployerBp);
  return {
    gross,
    amuBase,
    cnssEmployee,
    amuEmployee,
    taxable,
    irpp,
    net,
    cnssEmployer,
    amuEmployer,
    employerCost: gross + cnssEmployer + amuEmployer,
    belowSmig: gross < smig,
  };
}
