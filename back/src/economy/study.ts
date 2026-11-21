/** Études : niveaux de diplôme, conditions d'inscription et d'accès aux métiers, examen. Fonctions pures. */

export const RANKS = { BAC: 0, BT: 1, BTS: 2, LICENCE: 3, MASTER: 4, DOCTORAT: 5 } as const;
export type Rank = keyof typeof RANKS;
export type StudyKind = 'BT' | 'BTS' | 'LICENCE' | 'MASTER' | 'DOCTORAT';
export interface DiplomaLike {
  kind: string;
  domain: string;
}
export interface JobReqOption {
  min: Rank;
  /** Domaines acceptés ; absent = n'importe lequel. */
  domains?: string[];
}
/** Condition d'accès à un métier : une première option, plus des options alternatives (« ou »). */
export interface JobReq extends JobReqOption {
  or?: JobReqOption[];
}

const rankOf = (kind: string): number => (kind in RANKS ? RANKS[kind as Rank] : 0);

/** Le joueur remplit-il la condition d'un métier ? Un diplôme plus élevé dans le bon domaine suffit. */
export function meetsReq(req: JobReq | undefined, diplomas: DiplomaLike[]): boolean {
  if (!req || req.min === 'BAC') return true;
  // Plusieurs options possibles pour le même poste (ex. licence en informatique OU BTS en réseaux) : une seule suffit
  return [req, ...(req.or ?? [])].some((o) => o.min === 'BAC' || diplomas.some((d) => rankOf(d.kind) >= RANKS[o.min] && (!o.domains || o.domains.includes(d.domain))));
}

/** Code d'erreur si le joueur ne peut pas s'inscrire à ce cursus dans ce domaine, sinon null. */
export function enrollBlock(kind: StudyKind, domain: string, diplomas: DiplomaLike[]): string | null {
  const has = (k: string) => diplomas.some((d) => d.kind === k && d.domain === domain);
  if (has(kind)) return 'already_have_diploma';
  if (kind === 'MASTER' && !has('LICENCE')) return 'need_licence';
  if (kind === 'DOCTORAT' && !has('MASTER')) return 'need_master';
  return null;
}

/** Réussite à l'examen de fin d'année : assez de bonnes réponses sur les séances de l'année (seuil en points de base). */
export function examPassed(correct: number, sessions: number, minBp: number): boolean {
  return correct * 10_000 >= sessions * minBp;
}

/** Le diplôme le plus élevé obtenu (BAC si aucun). */
export function highest(diplomas: DiplomaLike[]): Rank {
  let best: Rank = 'BAC';
  for (const d of diplomas) if (rankOf(d.kind) > RANKS[best]) best = d.kind as Rank;
  return best;
}
