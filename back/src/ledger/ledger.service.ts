import { BadRequestException, ConflictException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type Tx = Prisma.TransactionClient;

export const SYSTEM_WALLETS = ['TREASURY', 'MARKET', 'FEES', 'LANDLORD', 'PURCHASES', 'BANK', 'CARRY', 'TONTINE'] as const;
export type SystemWallet = (typeof SYSTEM_WALLETS)[number];

export interface Leg {
  from: string;
  to: string;
  amount: bigint;
}

export class InsufficientFundsError extends BadRequestException {
  constructor() {
    super('insufficient_funds');
  }
}

/** Montant maximal d'un mouvement : garde-fou contre les débordements et les erreurs de saisie. */
export const MAX_AMOUNT = 1_000_000_000_000n;

/**
 * Grand livre en partie double.
 * - Chaque appel produit UNE transaction dont la somme des lignes vaut 0 (vérifié aussi par un trigger SQL).
 * - Les débits joueurs sont conditionnels (`balance >= montant`) : aucune course ne peut rendre un solde négatif.
 * - Les portefeuilles sont mis à jour dans l'ordre de leur identifiant pour éviter les interblocages.
 * - Une clé d'idempotence empêche qu'une requête rejouée débite deux fois.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(
    tx: Tx,
    input: { kind: string; legs: Leg[]; idempotencyKey?: string; requestHash?: string; memo?: string },
  ): Promise<{ transactionId: string; replay: boolean }> {
    if (input.idempotencyKey) {
      const existing = await this.findReplay(tx, input.idempotencyKey, input.requestHash);
      if (existing) return { transactionId: existing, replay: true };
    }
    if (input.legs.length === 0) throw new BadRequestException('empty_transaction');

    const net = new Map<string, bigint>();
    for (const leg of input.legs) {
      if (typeof leg.amount !== 'bigint' || leg.amount <= 0n || leg.amount > MAX_AMOUNT) {
        throw new BadRequestException('invalid_amount');
      }
      if (leg.from === leg.to) throw new BadRequestException('same_wallet');
      net.set(leg.from, (net.get(leg.from) ?? 0n) - leg.amount);
      net.set(leg.to, (net.get(leg.to) ?? 0n) + leg.amount);
    }

    const ids = [...net.keys()].sort();
    const wallets = await tx.wallet.findMany({ where: { id: { in: ids } }, select: { id: true, systemCode: true, currency: true } });
    if (wallets.length !== ids.length) throw new NotFoundException('wallet_not_found');
    const currencies = new Set(wallets.map((w) => w.currency));
    if (currencies.size !== 1) throw new BadRequestException('currency_mismatch');
    const isSystem = new Map(wallets.map((w) => [w.id, w.systemCode !== null]));

    const after = new Map<string, bigint>();
    for (const id of ids) {
      const delta = net.get(id)!;
      if (delta === 0n) continue;
      if (delta < 0n && !isSystem.get(id)) {
        const res = await tx.wallet.updateMany({
          where: { id, balance: { gte: -delta } },
          data: { balance: { increment: delta } },
        });
        if (res.count !== 1) throw new InsufficientFundsError();
        const w = await tx.wallet.findUniqueOrThrow({ where: { id }, select: { balance: true } });
        after.set(id, w.balance);
      } else {
        const w = await tx.wallet.update({ where: { id }, data: { balance: { increment: delta } }, select: { balance: true } });
        after.set(id, w.balance);
      }
    }

    const txn = await tx.ledgerTransaction.create({
      data: {
        kind: input.kind.slice(0, 32),
        idempotencyKey: input.idempotencyKey,
        requestHash: input.idempotencyKey ? (input.requestHash ?? null) : null,
        memo: input.memo?.slice(0, 140),
        entries: {
          create: ids
            .filter((id) => net.get(id) !== 0n)
            .map((id) => ({ walletId: id, amount: net.get(id)!, balanceAfter: after.get(id)! })),
        },
      },
      select: { id: true },
    });
    return { transactionId: txn.id, replay: false };
  }

  /**
   * Rejeu d'une clé d'idempotence : renvoie l'id de la transaction déjà enregistrée si la requête est identique,
   * lève 409 si la même clé est réutilisée pour une autre requête, null si la clé est nouvelle.
   * Les appelants NE réappliquent AUCUN effet de jeu lors d'un rejeu.
   */
  async findReplay(tx: Tx, idempotencyKey: string, requestHash?: string): Promise<string | null> {
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true, requestHash: true } });
    if (!existing) return null;
    if (existing.requestHash !== (requestHash ?? null)) throw new ConflictException('idempotency_key_reused');
    return existing.id;
  }

  async systemWalletId(tx: Tx | PrismaService, code: SystemWallet): Promise<string> {
    const w = await tx.wallet.findUnique({ where: { systemCode: code }, select: { id: true } });
    if (!w) throw new Error(`system wallet ${code} missing — run the seed`);
    return w.id;
  }

  /** Vérifie l'intégrité : chaque solde = somme de ses écritures, et le grand livre global somme à 0. */
  async verify(): Promise<{ ok: boolean; mismatches: { walletId: string; balance: string; ledger: string }[]; globalSum: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string; balance: bigint; ledger: bigint | null }[]>`
      SELECT w."id", w."balance", COALESCE(SUM(e."amount"), 0)::bigint AS ledger
      FROM "wallet" w LEFT JOIN "ledger_entry" e ON e."walletId" = w."id"
      GROUP BY w."id", w."balance"`;
    const mismatches = rows
      .filter((r) => r.balance !== (r.ledger ?? 0n))
      .map((r) => ({ walletId: r.id, balance: r.balance.toString(), ledger: (r.ledger ?? 0n).toString() }));
    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint | null }[]>`SELECT COALESCE(SUM("amount"),0)::bigint AS total FROM "ledger_entry"`;
    return { ok: mismatches.length === 0 && (total ?? 0n) === 0n, mismatches, globalSum: (total ?? 0n).toString() };
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
