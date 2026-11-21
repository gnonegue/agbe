import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Journal d'audit des actions sensibles (connexion, admin, paiements). Ne contient jamais de secret. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  /** `client` : passer la transaction en cours (`tx`) pour écrire dans la même transaction. */
  async log(
    action: string,
    opts: { actorId?: string | null; target?: string; meta?: Prisma.InputJsonValue; ip?: string } = {},
    client: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<void> {
    try {
      await client.auditLog.create({
        data: {
          action: action.slice(0, 64),
          actorId: opts.actorId ?? null,
          target: opts.target?.slice(0, 128),
          meta: opts.meta,
          ip: opts.ip?.slice(0, 64),
        },
      });
    } catch (e) {
      // L'audit ne doit jamais casser la requête, mais on le signale.
      this.logger.error(`audit write failed for ${action}: ${(e as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
