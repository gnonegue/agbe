import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientFundsError, LedgerService } from './ledger.service';

// Tests d'intégration sur une vraie base PostgreSQL (TEST_DATABASE_URL), jamais la base de dev/prod.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('LedgerService (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let treasury: string;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const tag = Date.now().toString(36);
    treasury = (await prisma.wallet.create({ data: { systemCode: `T_${tag}` } })).id;
    const mk = async (n: string) => {
      const acc = await prisma.account.create({ data: { email: `${n}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const c = await prisma.character.create({
        data: { accountId: acc.id, name: n, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } },
        include: { wallet: true },
      });
      return c.wallet!.id;
    };
    alice = await mk('alice');
    bob = await mk('bob');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: alice, amount: 1_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const bal = async (id: string) => (await prisma.wallet.findUniqueOrThrow({ where: { id } })).balance;

  it('refuse un débit supérieur au solde, sans rien écrire', async () => {
    await expect(prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: alice, to: bob, amount: 5_000n }] }))).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
    expect(await bal(alice)).toBe(1_000n);
    expect(await bal(bob)).toBe(0n);
  });

  it('refuse montants nuls, négatifs ou portefeuille identique', async () => {
    for (const amount of [0n, -1n]) {
      await expect(prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: alice, to: bob, amount }] }))).rejects.toThrow();
    }
    await expect(prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: alice, to: alice, amount: 1n }] }))).rejects.toThrow();
  });

  it('est idempotent : la même clé ne débite qu’une fois', async () => {
    const key = `idem-${Date.now()}`;
    const r1 = await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', idempotencyKey: key, legs: [{ from: alice, to: bob, amount: 100n }] }));
    const r2 = await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', idempotencyKey: key, legs: [{ from: alice, to: bob, amount: 100n }] }));
    expect(r2.replay).toBe(true);
    expect(r2.transactionId).toBe(r1.transactionId);
    expect(await bal(alice)).toBe(900n);
  });

  it('refuse la réutilisation d’une clé pour une requête différente (audit H1)', async () => {
    const key = `idem-h1-${Date.now()}`;
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', idempotencyKey: key, requestHash: 'eat|gari', legs: [{ from: treasury, to: bob, amount: 1n }] }));
    await expect(
      prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', idempotencyKey: key, requestHash: 'eat|fufu', legs: [{ from: treasury, to: bob, amount: 1n }] })),
    ).rejects.toThrow(/idempotency_key_reused/);
    const replay = await prisma.$transaction((tx) => ledger.findReplay(tx, key, 'eat|gari'));
    expect(replay).not.toBeNull();
  });

  it('résiste à 50 débits concurrents : jamais de solde négatif, argent conservé', async () => {
    const before = (await bal(alice)) + (await bal(bob));
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: alice, to: bob, amount: 50n }] }))),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(18); // 900 / 50
    expect(await bal(alice)).toBe(0n);
    expect((await bal(alice)) + (await bal(bob))).toBe(before);
  });

  it('chaque solde égale la somme de ses écritures', async () => {
    for (const id of [alice, bob, treasury]) {
      const s = await prisma.ledgerEntry.aggregate({ where: { walletId: id }, _sum: { amount: true } });
      expect(s._sum.amount ?? 0n).toBe(await bal(id));
    }
  });

  it('la base refuse une transaction déséquilibrée et toute modification du grand livre', async () => {
    await expect(
      prisma.ledgerTransaction.create({ data: { kind: 'HACK', entries: { create: [{ walletId: bob, amount: 1_000_000n, balanceAfter: 0n }] } } }),
    ).rejects.toThrow(/unbalanced/);
    const e = await prisma.ledgerEntry.findFirstOrThrow({ where: { walletId: bob } });
    await expect(prisma.ledgerEntry.update({ where: { id: e.id }, data: { amount: 999n } })).rejects.toThrow(/append-only/);
    await expect(prisma.wallet.update({ where: { id: bob }, data: { balance: -1n } })).rejects.toThrow();
  });
});
