// Séjour à l'hôtel (sans dépendance vers les services, pour éviter les imports circulaires).
import type { Tx } from '../ledger/ledger.service';
import type { PrismaService } from '../prisma/prisma.service';

/** Séjour en cours (nuit de `day` comprise) dans l'hôtel donné. */
export async function activeStay(tx: Tx | PrismaService, characterId: string, venueId: string, day: number) {
  return tx.hotelStay.findFirst({ where: { characterId, venueId, checkedOut: false, fromDay: { lte: day }, toDay: { gt: day } }, orderBy: { toDay: 'desc' } });
}

