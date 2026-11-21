import '../config/dotenv';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

// Contrôle d'intégrité du grand livre : à lancer en tâche planifiée (code de sortie 1 si incohérence).
async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    const r = await new LedgerService(prisma).verify();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
