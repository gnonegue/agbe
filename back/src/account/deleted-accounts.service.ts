import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

/** Efface chaque jour l'identité des comptes supprimés dont la durée de conservation est passée (sauf enquête en cours). */
@Injectable()
export class DeletedAccountsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DeletedAccounts');
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Un premier passage peu après le démarrage, puis une fois par jour
    this.timers.push(setTimeout(() => void this.purge(), 60_000), setInterval(() => void this.purge(), DAY_MS));
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  async purge(now = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.deletedAccount.deleteMany({ where: { purgeAt: { lte: now }, hold: false } });
      if (count) this.log.log(`${count} identité(s) de comptes supprimés effacée(s) (fin de conservation)`);
      return count;
    } catch (e) {
      this.log.error(`Effacement des comptes supprimés : ${(e as Error).message}`);
      return 0;
    }
  }
}
