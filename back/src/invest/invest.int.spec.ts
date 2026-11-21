import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { InvestService } from './invest.module';

// Investissements : bourse, saison agricole, seconde activité (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Investissements (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let inv: InvestService;
  let accountId: string;
  let walletId: string;
  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    inv = new InvestService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    for (const code of ['MARKET', 'FEES', 'BANK', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `investor-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Investisseur', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    walletId = c.wallet!.id;
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: 2_000_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('bourse : le cours vu, le prix payé et la fin de l’historique concordent ; prix d’achat moyen suivi', async () => {
    const v = await inv.view(accountId);
    const g = v.stocks.find((x) => x.symbol === 'GOZEM')!;
    expect(g.price).toBeGreaterThan(200);
    expect(g.price).toBeLessThan(22_000);
    expect(g.series.length).toBeGreaterThan(1);
    const h = await inv.history('GOZEM', '7d');
    expect(h.points[h.points.length - 1]!.p).toBe(h.points.length ? g.price : 0);
    expect(h.min).toBeLessThanOrEqual(g.price);
    expect(h.max).toBeGreaterThanOrEqual(g.price);
    await expect(inv.history('NOPE', '7d')).rejects.toThrow('unknown_stock');
    const b = await inv.buyStock(accountId, 'GOZEM', 4);
    const after = (await inv.view(accountId)).stocks.find((x) => x.symbol === 'GOZEM')!;
    expect(after.held).toBe(4);
    expect(after.heldCost).toBe(b.result.paid);
    await inv.sellStock(accountId, 'GOZEM', 4);
  });

  it('bourse : achat au cours du jour + frais, revente, actions insuffisantes refusées', async () => {
    const before = await bal();
    const b = await inv.buyStock(accountId, 'LCIM', 10);
    expect(before - (await bal())).toBe(BigInt(b.result.paid));
    await expect(inv.sellStock(accountId, 'LCIM', 11)).rejects.toThrow('not_enough_shares');
    const s = await inv.sellStock(accountId, 'LCIM', 10);
    expect(BigInt(s.result.received)).toBeGreaterThan(0n);
  });

  it('saison agricole : pas de récolte avant la fin, puis paiement unique', async () => {
    const r = await inv.startVenture(accountId, 'farm_mais');
    const id = r.result.venture!;
    await expect(inv.collect(accountId, id)).rejects.toThrow('harvest_not_ready');
    await prisma.venture.update({ where: { id }, data: { startedAt: new Date(Date.now() - 365 * 86_400_000) } });
    const v = await prisma.venture.findUniqueOrThrow({ where: { id } });
    const before = await bal();
    const c = await inv.collect(accountId, id);
    expect((await bal()) - before).toBe(v.payout);
    expect(c.result.closed).toBe(true);
    await expect(inv.collect(accountId, id)).rejects.toThrow('venture_closed');
  });

  it('seconde activité : revenu accumulé, jamais payé deux fois', async () => {
    const r = await inv.startVenture(accountId, 'biz_kiosque');
    const id = r.result.venture!;
    const first = await inv.collect(accountId, id);
    const second = await inv.collect(accountId, id);
    expect(BigInt(second.result.received)).toBeLessThanOrEqual(BigInt(first.result.received) + 1_000_000n);
    const v = await prisma.venture.findUniqueOrThrow({ where: { id } });
    expect(v.collected).toBeLessThanOrEqual(v.payout);
  });

  it('épargne : dépôt, intérêts après quelques jours, retrait borné au solde', async () => {
    await inv.deposit(accountId, 100_000);
    // Simule 10 jours de jeu écoulés depuis le dernier versement
    const acc = await prisma.savingsAccount.findFirstOrThrow({ where: { balance: 100_000n } });
    await prisma.savingsAccount.update({ where: { characterId: acc.characterId }, data: { lastAccruedDay: acc.lastAccruedDay - 10 } });
    const s = await inv.savings(accountId);
    expect(BigInt(s.result.interest)).toBe(300n);
    expect(BigInt(s.result.balance)).toBe(100_300n);
    await expect(inv.withdraw(accountId, 200_000)).rejects.toThrow('savings_insufficient');
    const before = await bal();
    await inv.withdraw(accountId, 100_300);
    expect((await bal()) - before).toBe(100_300n);
  });

  it('grand livre équilibré', async () => {
    expect((await ledger.verify()).globalSum).toBe('0');
  });
});
