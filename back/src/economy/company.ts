// Calculs de l'entreprise (fonctions pures, montants en BigInt, taux en points de base).
// Sources : document de conception (CFE, CNSS TNS 21,5 %, AMU TNS forfait). Les taux marqués « à valider »
// sont des paramètres du back-office, à confirmer par un expert-comptable togolais avant lancement.
import { applyRate } from './money';
import { GAME_DAYS_PER_MONTH } from './clock';

export type CompanyForm = 'EI' | 'SARL' | 'SA';

export interface CfeConfig {
  feeEI: number;
  feeSociety: number;
  feeSocietyNonEcowas: number;
  delayGameHours: number;
}

export interface ContributionConfig {
  /** CNSS travailleur indépendant (TNS) : 21,5 % du revenu déclaré. */
  cnssTnsBp: number;
  /** AMU des non-salariés : forfait mensuel. */
  amuTnsMonthly: number;
  /** Impôt OTR sur le chiffre d'affaires (à valider). */
  otrBp: number;
  /** Pénalité de retard par mois de retard, sur le total dû (à valider). */
  penaltyBpPerMonth: number;
  /** Jours de jeu de tolérance après la fin du mois. */
  graceDays: number;
  /** Amende si un salarié n'est pas immatriculé à la CNSS 8 jours après l'embauche (à valider). */
  unregisteredFine: number;
  maxEmployees: number;
}

/** Frais du dossier CFE selon la forme et la nationalité du déclarant. */
export function cfeFee(form: CompanyForm, outsideEcowas: boolean, cfg: CfeConfig): bigint {
  if (form === 'EI') return BigInt(cfg.feeEI);
  return BigInt(outsideEcowas ? cfg.feeSocietyNonEcowas : cfg.feeSociety);
}

/** Pénalité de retard maximale : 200 % de la somme due. */
export const MAX_PENALTY_BP = 20_000;

export const monthOf = (gameDay: number): number => Math.floor(gameDay / GAME_DAYS_PER_MONTH);

export interface Declaration {
  /** Mois de jeu couverts (inclus). */
  fromMonth: number;
  toMonth: number;
  months: number;
  overdueMonths: number;
  revenue: bigint;
  /** Chiffre d'affaires des usines et sites (impôt OTR seulement). */
  plantRevenue: bigint;
  cnss: bigint;
  amu: bigint;
  otr: bigint;
  penalty: bigint;
  total: bigint;
}

/**
 * Déclaration des mois de jeu clos et non déclarés.
 * Un mois m est dû au jour (m + 1) × 30 + graceDays ; chaque mois en retard ajoute la pénalité sur le total.
 * Renvoie null s'il n'y a aucun mois clos à déclarer.
 */
export function computeDeclaration(
  args: { lastDeclaredMonth: number; createdMonth: number; today: number; pendingRevenue: bigint; plantRevenue?: bigint },
  cfg: ContributionConfig,
): Declaration | null {
  const fromMonth = Math.max(args.lastDeclaredMonth + 1, args.createdMonth);
  const toMonth = monthOf(args.today) - 1; // dernier mois clos
  if (toMonth < fromMonth) return null;
  const months = toMonth - fromMonth + 1;
  let overdueMonths = 0;
  for (let m = fromMonth; m <= toMonth; m++) {
    const due = (m + 1) * GAME_DAYS_PER_MONTH + cfg.graceDays;
    if (args.today > due) overdueMonths += Math.ceil((args.today - due) / GAME_DAYS_PER_MONTH);
  }
  const revenue = args.pendingRevenue < 0n ? 0n : args.pendingRevenue;
  const cnss = applyRate(revenue, cfg.cnssTnsBp);
  const amu = BigInt(cfg.amuTnsMonthly) * BigInt(months);
  // Chiffre d'affaires des usines et sites de l'entreprise : soumis à l'impôt OTR seulement (la CNSS du dirigeant porte sur
  // son activité, pas sur le chiffre d'affaires d'une usine)
  const plant = args.plantRevenue && args.plantRevenue > 0n ? args.plantRevenue : 0n;
  const otr = applyRate(revenue + plant, cfg.otrBp);
  const base = cnss + amu + otr;
  // Pénalité plafonnée au double de la somme due : un joueur longtemps absent paie cher, mais le calcul ne dépasse jamais
  // la limite des taux (sinon erreur serveur à chaque action du joueur)
  const penalty = applyRate(base, Math.min(cfg.penaltyBpPerMonth * overdueMonths, MAX_PENALTY_BP));
  return { fromMonth, toMonth, months, overdueMonths, revenue, plantRevenue: plant, cnss, amu, otr, penalty, total: base + penalty };
}

/** Délai légal d'immatriculation d'un salarié à la CNSS (jours de jeu). */
export const CNSS_EMPLOYEE_DELAY_DAYS = 8;

const FIRST = ['Kossi', 'Ama', 'Yao', 'Akossiwa', 'Komla', 'Edem', 'Afi', 'Mawuli', 'Dzifa', 'Sena', 'Kodjo', 'Adjoa', 'Essowè', 'Pyabalo', 'Tchilalo', 'Yendoubé', 'Fousseni', 'Abla', 'Kafui', 'Délali'];
const LAST = ['Agbodjan', 'Mensah', 'Amouzou', 'Lawson', 'Kpatcha', 'Tchalla', 'Adjavon', 'Gnassingbé', 'Akakpo', 'Dogbé', 'Afanou', 'Koffi', 'Sossou', 'Bawa', 'Ouro-Bang’na', 'Assih'];

/** Générateur déterministe (même graine = mêmes candidats) : la liste ne peut pas être falsifiée par le client. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface Candidate {
  id: string;
  name: string;
  roleIndex: number;
  grossMonthly: number;
  experienceYears: number;
}

/** Candidats du jour pour une entreprise : salaire demandé entre le SMIG et 1,8 × SMIG, arrondi à 500 F. */
export function candidatesFor(companyId: string, gameDay: number, smig: number, roles: number): Candidate[] {
  let h = gameDay * 2654435761;
  for (const ch of companyId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = seeded(h);
  return Array.from({ length: 5 }, (_, i) => {
    const exp = Math.floor(r() * 8);
    const gross = Math.ceil((smig * (1 + r() * 0.5 + exp * 0.04)) / 500) * 500;
    return {
      id: `${gameDay}-${i}`,
      name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
      roleIndex: Math.floor(r() * Math.max(1, roles)),
      grossMonthly: Math.max(smig, Math.min(gross, Math.round(smig * 1.8))),
      experienceYears: exp,
    };
  });
}

export interface PortfolioConfig {
  maxCompanies: number;
  saleShifts: number;
  saleShiftsPerEmployee: number;
  employeeSaleBp: number;
  maxCatchUpShifts: number;
}

/** Bénéfice net d'une séance du patron (chiffre d'affaires moins coûts de l'activité). */
export const shiftNet = (act: { revenue: number; cost: number }): number => Math.max(0, act.revenue - act.cost);

/** Prix de rachat d'une entreprise immatriculée : bénéfice d'une séance × (séances de base + séances par salarié actif). Entier FCFA. */
export function companySalePrice(act: { revenue: number; cost: number }, employees: number, cfg: PortfolioConfig): bigint {
  return BigInt(shiftNet(act)) * BigInt(cfg.saleShifts + cfg.saleShiftsPerEmployee * employees);
}

/** Ventes seules des salariés pour `shifts` séances écoulées : chiffre d'affaires et bénéfice net versé au patron (entiers FCFA). */
export function autoSale(act: { revenue: number; cost: number }, employees: number, shifts: number, cfg: PortfolioConfig): { gross: bigint; net: bigint } {
  const k = BigInt(employees) * BigInt(shifts);
  return { gross: (BigInt(act.revenue) * BigInt(cfg.employeeSaleBp) * k) / 10_000n, net: (BigInt(shiftNet(act)) * BigInt(cfg.employeeSaleBp) * k) / 10_000n };
}
