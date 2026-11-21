import type { Tx } from '../ledger/ledger.service';

type Db = Pick<Tx, 'company' | 'character'>;

/**
 * Entreprise « en cours » d'un joueur : celle qu'il a choisie parmi ses entreprises ouvertes, sinon la plus ancienne.
 * Les entreprises vendues ou fermées (CLOSED) ne comptent plus. null = aucune.
 */
export async function activeCompanyId(db: Db, characterId: string): Promise<string | null> {
  const [ch, list] = await Promise.all([
    db.character.findUnique({ where: { id: characterId }, select: { activeCompanyId: true } }),
    db.company.findMany({ where: { characterId, status: { not: 'CLOSED' } }, select: { id: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (list.length === 0) return null;
  return list.find((x) => x.id === ch?.activeCompanyId)?.id ?? list[0]!.id;
}
