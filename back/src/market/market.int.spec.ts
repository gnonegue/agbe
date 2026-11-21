import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { MarketService } from './market.service';

// Marché entre joueurs (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Marché entre joueurs (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let svc: MarketService;
  const P: { account: string; character: string; wallet: string }[] = [];
  const bal = async (i: number) => (await prisma.wallet.findUniqueOrThrow({ where: { id: P[i]!.wallet } })).balance;
  const at = (i: number, loc: string) => prisma.character.update({ where: { id: P[i]!.character }, data: { locationId: loc } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    svc = new MarketService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    await prisma.gameSetting.upsert({ where: { key: 'venues.hours' }, create: { key: 'venues.hours', value: {} }, update: { value: {} } });
    // Aucun événement économique pendant le test : prix de gros nominal
    await prisma.gameSetting.upsert({ where: { key: 'economy.events' }, create: { key: 'economy.events', value: [] }, update: { value: [] } });
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    const tag = Date.now().toString(36);
    for (const n of ['Vendeuse', 'Client', 'Client2']) {
      const acc = await prisma.account.create({ data: { email: `mkt-${n}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const c = await prisma.character.create({ data: { accountId: acc.id, name: n, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', hunger: 30, wallet: { create: {} } }, include: { wallet: true } });
      await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 200_000n }] }));
      P.push({ account: acc.id, character: c.id, wallet: c.wallet!.id });
    }
  });

  afterAll(async () => {
    await prisma?.gameSetting.deleteMany({ where: { key: 'economy.events' } });
    await prisma?.$disconnect();
  });

  it('étal, gros, prix, vente taxée, stock disputé, usage', async () => {
    await at(0, 'home');
    await expect(svc.rent(P[0]!.account, 1)).rejects.toThrow('not_at_market');
    await at(0, 'marche_assigame');
    await svc.rent(P[0]!.account, 2);
    const b0 = await bal(0);
    await svc.wholesale(P[0]!.account, 'gari', 10);
    expect(await bal(0)).toBe(b0 - 7_000n);
    await expect(svc.setPrice(P[0]!.account, 'gari', 1_401)).rejects.toThrow('price_out_of_bounds');
    await svc.setPrice(P[0]!.account, 'gari', 1_000);

    await at(1, 'marche_agoe');
    await expect(svc.buy(P[1]!.account, (await prisma.stall.findUniqueOrThrow({ where: { characterId: P[0]!.character } })).id, 'gari', 1)).rejects.toThrow('not_at_stall');
    await at(1, 'marche_assigame');
    await at(2, 'marche_assigame');
    const list = await svc.stalls(P[1]!.account);
    const own = await prisma.stall.findUniqueOrThrow({ where: { characterId: P[0]!.character } });
    const stall = list.stalls.find((s) => s.id === own.id)!;
    expect(stall.items).toEqual([{ goodId: 'gari', qty: 10, price: 1_000 }]);

    const [s0, s1] = [await bal(0), await bal(1)];
    await svc.buy(P[1]!.account, stall.id, 'gari', 3);
    expect(await bal(1)).toBe(s1 - 3_000n);
    expect(await bal(0)).toBe(s0 + 2_940n); // taxe de marché 2 %

    // Deux acheteurs pour les 7 derniers : un seul obtient 5, l'autre est refusé
    const r = await Promise.allSettled([svc.buy(P[1]!.account, stall.id, 'gari', 5), svc.buy(P[2]!.account, stall.id, 'gari', 5)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    await expect(svc.buy(P[0]!.account, stall.id, 'gari', 1)).rejects.toThrow('own_stall');

    const before = await prisma.character.findUniqueOrThrow({ where: { id: P[1]!.character } });
    await svc.use(P[1]!.account, 'gari');
    const after = await prisma.character.findUniqueOrThrow({ where: { id: P[1]!.character } });
    expect(after.hunger).toBeGreaterThan(before.hunger);
    const mine = await svc.mine(P[0]!.account);
    expect(BigInt(mine.stall!.sales)).toBeGreaterThanOrEqual(3_000n);
    expect((await ledger.verify()).ok).toBe(true);
  });
});
