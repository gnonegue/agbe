import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { TontineService } from './tontine.service';
import { gameTimeAt } from '../economy/clock';

// Tontine entre joueurs : séquestre, ramassage, défaillance, remboursement (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Tontine (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let svc: TontineService;
  const P: { account: string; character: string; wallet: string }[] = [];
  const bal = async (i: number) => (await prisma.wallet.findUniqueOrThrow({ where: { id: P[i]!.wallet } })).balance;
  const today = async () => gameTimeAt(await settings.clock(), Date.now()).day;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    svc = new TontineService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    for (const code of ['TREASURY', 'MARKET', 'TONTINE']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await prisma.gameSetting.upsert({
      where: { key: 'tontine' },
      create: { key: 'tontine', value: { minContribution: 1000, maxContribution: 200000, periods: [7, 30], minMembers: 3, maxMembers: 12, missRespect: 15, missMorale: 10, maxActive: 3, maxDefaultsToJoin: 2, minAccountAgeHours: 0 } },
      update: { value: { minContribution: 1000, maxContribution: 200000, periods: [7, 30], minMembers: 3, maxMembers: 12, missRespect: 15, missMorale: 10, maxActive: 3, maxDefaultsToJoin: 2, minAccountAgeHours: 0 } },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    const tag = Date.now().toString(36);
    for (const n of ['Ama', 'Kofi', 'Yawa']) {
      const acc = await prisma.account.create({ data: { email: `tnt-${n}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const c = await prisma.character.create({ data: { accountId: acc.id, name: n, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } }, include: { wallet: true } });
      await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 100_000n }] }));
      P.push({ account: acc.id, character: c.id, wallet: c.wallet!.id });
    }
  });

  afterAll(async () => {
    await prisma?.gameSetting.deleteMany({ where: { key: { in: ['tontine'] } } });
    await prisma?.$disconnect();
  });

  it('cycle complet : inscriptions, tirage, cotisations, ramassage anticipé puis à l’échéance', async () => {
    await expect(svc.create(P[0]!.account, { name: 'Tontine du marché', contribution: 500, periodDays: 7, maxMembers: 3 })).rejects.toThrow('tontine_bad_contribution');
    const id = (await svc.create(P[0]!.account, { name: 'Tontine du marché', contribution: 10_000, periodDays: 7, maxMembers: 3 })).result.tontine;
    await expect(svc.start(P[0]!.account, id)).rejects.toThrow('tontine_not_enough');
    await svc.join(P[1]!.account, id);
    await expect(svc.join(P[1]!.account, id)).rejects.toThrow('tontine_already_member');
    await expect(svc.start(P[1]!.account, id)).rejects.toThrow('tontine_not_owner');
    await svc.join(P[2]!.account, id);
    await svc.start(P[0]!.account, id);

    const members = await prisma.tontineMember.findMany({ where: { tontineId: id } });
    expect(members.map((m) => m.turn).sort()).toEqual([0, 1, 2]);
    const idxOfTurn = (r: number) => P.findIndex((p) => p.character === members.find((m) => m.turn === r)!.characterId);

    // Tour 0 : tout le monde cotise, le premier bénéficiaire ramasse tout de suite
    const before = await Promise.all([0, 1, 2].map(bal));
    for (const i of [0, 1, 2]) await svc.pay(P[i]!.account, id);
    await expect(svc.pay(P[0]!.account, id)).rejects.toThrow('tontine_already_paid');
    const b0 = idxOfTurn(0);
    const other = [0, 1, 2].find((i) => i !== b0)!;
    await expect(svc.collect(P[other]!.account, id)).rejects.toThrow('tontine_not_your_turn');
    const r = (await svc.collect(P[b0]!.account, id)).result;
    expect(r.amount).toBe('30000');
    expect(await bal(b0)).toBe(before[b0]! - 10_000n + 30_000n);

    // Tour 1 : le bénéficiaire du tour 2 ne cotise pas ; l'échéance passe → défaillant, le tour 1 est quand même versé
    const b1 = idxOfTurn(1);
    const b2 = idxOfTurn(2);
    for (const i of [0, 1, 2].filter((i) => i !== b2)) await svc.pay(P[i]!.account, id);
    await prisma.tontine.update({ where: { id }, data: { startDay: (await today()) - 14 } });
    const beforeB1 = await bal(b1);
    await svc.list(P[0]!.account);
    expect(await bal(b1)).toBe(beforeB1 + 20_000n);
    const late = await prisma.character.findUniqueOrThrow({ where: { id: P[b2]!.character } });
    expect(late.tontineDefaults).toBe(1);

    // Tour 2 : le bénéficiaire défaillant ne ramasse pas ; les cotisants sont remboursés
    for (const i of [0, 1, 2]) await svc.pay(P[i]!.account, id);
    const mid = await Promise.all([0, 1, 2].map(bal));
    await prisma.tontine.update({ where: { id }, data: { startDay: (await today()) - 21 } });
    await svc.list(P[0]!.account);
    expect(await Promise.all([0, 1, 2].map(bal))).toEqual(mid.map((x) => x + 10_000n));
    const t = await prisma.tontine.findUniqueOrThrow({ where: { id } });
    expect(t.status).toBe('FINISHED');

    // Sous-compte soldé : tout ce qui a été cotisé a été reversé
    const ins = await prisma.tontineContribution.aggregate({ _sum: { amount: true }, where: { tontineId: id } });
    const outs = await prisma.tontinePayout.aggregate({ _sum: { amount: true }, where: { tontineId: id } });
    expect(outs._sum.amount).toBe(ins._sum.amount);
    expect((await ledger.verify()).ok).toBe(true);
  });

  it('l’organisateur qui quitte avant le démarrage annule la tontine', async () => {
    const id = (await svc.create(P[1]!.account, { name: 'Petite tontine', contribution: 2_000, periodDays: 30, maxMembers: 4 })).result.tontine;
    await svc.join(P[0]!.account, id);
    await svc.leave(P[0]!.account, id);
    expect((await svc.leave(P[1]!.account, id)).result.cancelled).toBe(true);
    await expect(svc.join(P[2]!.account, id)).rejects.toThrow('tontine_not_open');
  });
});
