import type { StudyState } from '../api/endpoints';

const RANK = { BAC: 0, BT: 1, BTS: 2, LICENCE: 3, MASTER: 4, DOCTORAT: 5 } as const;
type Req = StudyState['jobReq'][string];

/** Même règle que le serveur : un diplôme au moins égal, dans un domaine accepté, remplit la condition du métier. */
export function meetsReq(req: Req | undefined, diplomas: StudyState['diplomas']): boolean {
  if (!req || req.min === 'BAC') return true;
  return reqOptions(req).some((o) => o.min === 'BAC' || diplomas.some((d) => RANK[d.kind] >= RANK[o.min] && (!o.domains || o.domains.includes(d.domain))));
}

/** Toutes les options acceptées pour un métier (la première, puis les alternatives « ou »). */
export function reqOptions(req: Req): { min: 'BAC' | keyof typeof RANK; domains?: string[] }[] {
  return [{ min: req.min, domains: req.domains }, ...(req.or ?? [])];
}
