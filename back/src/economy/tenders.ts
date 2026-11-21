// Marchés publics (tenders) : calculs purs (coût de réalisation, score de sélection), aucun accès réseau ni
// base de données. Candidature par enchère : le candidat propose un prix (≤ maxBudget, plafond annoncé) ET un
// délai (≤ maxHours), le montant réellement payé au gagnant est celui qu'il a proposé, jamais le plafond.

export interface Candidature {
  id: string;
  proposedPrice: bigint;
  proposedHours: number;
  /** Horodatage de dépôt (ms epoch) : départage déterministe à score égal (la plus ancienne gagne). */
  createdAtMs: number;
}

/** Pondération prix/délai du score de sélection, en points de base (doivent sommer à 10 000). */
export interface ScoreWeightsBp {
  priceBp: number;
  hoursBp: number;
}

/**
 * Coût réel de réalisation d'un marché : `requiredSessions` séances de travail dans le secteur, chacune coûtant
 * `sectorCost` (FCFA, `company.activities[sector].cost`). Connu de TOUS les candidats avant de candidater,
 * indépendamment du prix/délai qu'ils proposeront — résout le problème d'œuf-et-la-poule prix/durée/coût.
 */
export function tenderRealizationCost(requiredSessions: number, sectorCost: number): bigint {
  return BigInt(Math.max(0, requiredSessions)) * BigInt(Math.max(0, sectorCost));
}

/**
 * Durée minimale physiquement possible pour exécuter `requiredSessions` séances d'affilée (heures de jeu) :
 * impossible d'aller plus vite que d'enchaîner les séances de travail. Sert de borne basse à `proposedHours`.
 */
export function tenderMinPhysicalHours(requiredSessions: number, shiftGameHours: number): number {
  return Math.max(0, requiredSessions) * Math.max(0, shiftGameHours);
}

/**
 * Score d'une candidature (plus haut = mieux), dans [0, 1] : combinaison pondérée du prix proposé (bas = mieux)
 * et du délai proposé (court = mieux), chacun exprimé en ratio du plafond annoncé par le marché. N'est utilisé
 * que pour classer les candidatures entre elles, jamais pour calculer un montant d'argent (le montant payé est
 * toujours `proposedPrice`, choisi par le candidat).
 */
export function tenderScore(c: { proposedPrice: bigint; proposedHours: number }, maxBudget: bigint, maxHours: number, weights: ScoreWeightsBp): number {
  const priceRatio = maxBudget > 0n ? Number(c.proposedPrice) / Number(maxBudget) : 0;
  const hoursRatio = maxHours > 0 ? c.proposedHours / maxHours : 0;
  const priceScore = Math.max(0, Math.min(1, 1 - priceRatio));
  const hoursScore = Math.max(0, Math.min(1, 1 - hoursRatio));
  return (weights.priceBp * priceScore + weights.hoursBp * hoursScore) / 10_000;
}

/**
 * Sélectionne les `slots` meilleures candidatures (score décroissant), départagées de façon déterministe
 * (la plus ancienne candidature gagne) : jamais de tirage aléatoire pour une décision qui affecte de l'argent.
 */
export function selectTopCandidates<T extends { id: string; score: number; createdAtMs: number }>(candidates: T[], slots: number): { selected: T[]; rejected: T[] } {
  const sorted = [...candidates].sort((a, b) => (b.score !== a.score ? b.score - a.score : a.createdAtMs !== b.createdAtMs ? a.createdAtMs - b.createdAtMs : a.id < b.id ? -1 : 1));
  return { selected: sorted.slice(0, Math.max(0, slots)), rejected: sorted.slice(Math.max(0, slots)) };
}
