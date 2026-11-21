import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { CompanyService } from './company.service';
import { computePayroll } from '../economy/payroll';
import { gameTimeAt } from '../economy/clock';
import { monthOf } from '../economy/company';

// Emploi entre joueurs : offre du patron, acceptation, paie versée au salarié joueur (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Emploi entre joueurs (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let svc: CompanyService;
  const boss = { account: '', character: '', wallet: '' };
  const worker = { account: '', character: '', wallet: '' };
  const other = { account: '', character: '', wallet: '' };
  const balance = async (w: string) => (await prisma.wallet.findUniqueOrThrow({ where: { id: w } })).balance;

  async function player(tag: string, who: typeof boss, name: string) {
    const acc = await prisma.account.create({ data: { email: `${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } },
      include: { wallet: true },
    });
    Object.assign(who, { account: acc.id, character: c.id, wallet: c.wallet!.id });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    const chars = new CharacterService(prisma, ledger, settings);
    svc = new CompanyService(prisma, ledger, settings, chars);
    await prisma.gameSetting.upsert({ where: { key: 'transfer.limits' }, create: { key: 'transfer.limits', value: { minAccountAgeHours: 0, dailySendMax: 50000, dailyReceiveMax: 100000 } }, update: { value: { minAccountAgeHours: 0, dailySendMax: 50000, dailyReceiveMax: 100000 } } });
    for (const code of ['TREASURY', 'BANK', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    await player(`boss-${tag}`, boss, 'Patronne');
    await player(`worker-${tag}`, worker, 'Salarié');
    await player(`other-${tag}`, other, 'Autre');
    await prisma.company.create({
      data: { characterId: boss.character, name: `Pagnes ${tag}`, activityId: 'pagnes', form: 'EI', status: 'REGISTERED', readyAt: new Date(), createdMonth: monthOf(gameTimeAt(await settings.clock(), Date.now()).day) },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: boss.wallet, amount: 1_000_000n }] }));
  });

  afterAll(async () => {
    await prisma?.gameSetting.deleteMany({ where: { key: 'transfer.limits' } });
    await prisma?.$disconnect();
  });

  it('offre, acceptation unique, paie mensuelle au salarié joueur, licenciement après paie', async () => {
    const smig = (await settings.get('payroll.rates')).smig;
    await expect(svc.postOffer(boss.account, 0, smig - 1)).rejects.toThrow('salary_below_smig');
    await expect(svc.postOffer(boss.account, 99, smig)).rejects.toThrow('unknown_role');
    const offer = (await svc.postOffer(boss.account, 0, 80_000)).result.offer;

    // Le patron ne voit pas sa propre offre, les autres oui
    expect((await svc.board(boss.account)).some((o) => o.id === offer)).toBe(false);
    expect((await svc.board(worker.account)).some((o) => o.id === offer)).toBe(true);
    await expect(svc.acceptOffer(boss.account, offer)).rejects.toThrow('own_company');

    await svc.acceptOffer(worker.account, offer);
    await expect(svc.acceptOffer(other.account, offer)).rejects.toThrow('unknown_offer');
    const job = await svc.myJob(worker.account);
    expect(job?.grossMonthly).toBe(80_000);

    // Un mois clos non payé
    const e = await prisma.employee.findFirstOrThrow({ where: { characterId: worker.character, active: true } });
    await prisma.employee.update({ where: { id: e.id }, data: { lastPaidMonth: e.hiredMonth - 2, cnssNumber: `S${Date.now() % 1e8}` } });
    await expect(svc.fire(boss.account, e.id)).rejects.toThrow('pay_before_fire');

    const before = { boss: await balance(boss.wallet), worker: await balance(worker.wallet) };
    const r = (await svc.payroll(boss.account)).result;
    const p = computePayroll(80_000n, await settings.get('payroll.rates'));
    expect(await balance(worker.wallet)).toBe(before.worker + p.net);
    expect(await balance(boss.wallet)).toBe(before.boss - p.employerCost);
    expect(BigInt(r.paid)).toBe(p.employerCost);

    await svc.fire(boss.account, e.id);
    expect(await svc.myJob(worker.account)).toBeNull();
  });

  it('démission', async () => {
    const offer = (await svc.postOffer(boss.account, 1, 60_000)).result.offer;
    await svc.acceptOffer(other.account, offer);
    await svc.quit(other.account);
    expect(await svc.myJob(other.account)).toBeNull();
    await expect(svc.quit(other.account)).rejects.toThrow('not_employed');
  });
});
