import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { CompanyService } from './company.service';
import { computePayroll } from '../economy/payroll';
import { GAME_DAYS_PER_MONTH, gameTimeAt } from '../economy/clock';
import { monthOf } from '../economy/company';

// Emplois salariés des employeurs publics : offres par métier, verrou de qualification, salaire au prorata des services (base réelle).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Emplois publics (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let svc: CompanyService;
  const me = { account: '', character: '', wallet: '' };
  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: me.wallet } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    svc = new CompanyService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    for (const code of ['TREASURY', 'BANK', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    // Le métier test doit être le moins payé de son niveau (salaire = bas de la bande, le SMIG), quels que soient les métiers
    // créés par les autres tests qui partagent la base (ex. zem-flow crée un laveur à 2 000) : paie de 1 et forcée à chaque lancement
    await prisma.job.upsert({ where: { id: 'pj_street' }, create: { id: 'pj_street', level: 'DEBROUILLE', nameFr: 'Vendeur test', nameEn: 'Test vendor', payPerShift: 1, energyCost: 5, hungerCost: 5, shiftGameHours: 6 }, update: { payPerShift: 1, enabled: true } });
    await prisma.job.createMany({
      data: [
        { id: 'pj_cars', level: 'DEBROUILLE', nameFr: 'Livreur test', nameEn: 'Test rider', payPerShift: 3050, energyCost: 5, hungerCost: 5, shiftGameHours: 6 },
        { id: 'pj_boss', level: 'DIPLOME', nameFr: 'Cadre test', nameEn: 'Test manager', payPerShift: 20000, energyCost: 5, hungerCost: 5, shiftGameHours: 6 },
      ],
      skipDuplicates: true,
    });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `pub-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Salarié public', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } },
      include: { wallet: true },
    });
    Object.assign(me, { account: acc.id, character: c.id, wallet: c.wallet!.id });
  });

  afterAll(async () => {
    await prisma?.employee.deleteMany({ where: { characterId: me.character } });
    await prisma?.$disconnect();
  });

  it('offres publiques dans la bande, métier diplômé verrouillé, salaire au prorata, une seule fois', async () => {
    const board = await svc.board(me.account);
    const street = board.find((o) => o.id === 'job:pj_street');
    const rider = board.find((o) => o.id === 'job:pj_cars');
    expect(street?.grossMonthly).toBe(52_500);
    // Le salaire du métier le mieux payé de la bande dépend des autres métiers de la base : on vérifie la bande, pas une valeur
    expect(rider!.grossMonthly).toBeGreaterThan(street!.grossMonthly);
    expect(rider!.grossMonthly).toBeLessThanOrEqual(80_000);
    expect(board.find((o) => o.id === 'job:pj_boss')?.grossMonthly).toBeGreaterThanOrEqual(160_000);

    await expect(svc.acceptOffer(me.account, 'job:pj_boss')).rejects.toThrow('job_locked');
    await svc.acceptOffer(me.account, 'job:pj_street');
    await expect(svc.acceptOffer(me.account, 'job:pj_cars')).rejects.toThrow('already_employed');
    // Mois d'embauche incomplet : rien à toucher
    await expect(svc.claimSalary(me.account)).rejects.toThrow('nothing_to_pay');

    // Deux mois clos plus tard : 6 services sur 12 le premier mois, aucun le second
    const e = await prisma.employee.findFirstOrThrow({ where: { characterId: me.character, active: true } });
    const day = gameTimeAt(await settings.clock(), Date.now()).day;
    const closed = monthOf(day) - 1;
    await prisma.employee.update({ where: { id: e.id }, data: { lastPaidMonth: closed - 2 } });
    const clock = await settings.clock();
    const monthMs = GAME_DAYS_PER_MONTH * clock.secondsPerGameDay * 1000;
    const inMonth = (m: number) => new Date(clock.epochRealMs + m * monthMs + 60_000);
    await prisma.workShift.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ characterId: me.character, kind: 'job', sourceId: 'pj_street', orders: [], startedAt: new Date(inMonth(closed - 1).getTime() + i * 1000), endsAt: inMonth(closed - 1), closedAt: inMonth(closed - 1) })),
    });
    const before = await balance();
    const r = (await svc.claimSalary(me.account)).result;
    const net = computePayroll(52_500n, await settings.get('payroll.rates')).net;
    expect(BigInt(r.net)).toBe((net * 5000n) / 10_000n);
    expect(r.months).toBe(2);
    expect(r.paidMonths).toBe(1);
    expect((await balance()) - before).toBe(BigInt(r.net));
    // Pas de double paiement
    await expect(svc.claimSalary(me.account)).rejects.toThrow('nothing_to_pay');
    expect((await svc.myJob(me.account))?.publicJobId).toBe('pj_street');
  });
});
