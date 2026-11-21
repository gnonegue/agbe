import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { gameTimeAt } from '../economy/clock';
import { SchoolService } from './school.module';

// Cours du soir : inscription payée une fois, entrée en classe, cours suivi jusqu'au bout, question à la fin.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Cours du soir (PostgreSQL)', () => {
  let prisma: PrismaService;
  let school: SchoolService;
  let settings: SettingsService;
  let account = '';
  let character = '';
  let day = 0;
  /** Place l'horloge réelle (seulement `Date`) à une heure de jeu donnée, `day` jours plus tard. */
  const at = async (hour: number, minute = 0) => {
    const cfg = await settings.clock();
    vi.setSystemTime(cfg.epochRealMs + (((day * 1440 + hour * 60 + minute) * cfg.secondsPerGameDay) / 1440) * 1000 + 500);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    await prisma.gameSetting.deleteMany({ where: { key: { in: ['school.courses', 'school.class'] } } });
    const chars = new CharacterService(prisma, ledger, settings);
    school = new SchoolService(prisma, ledger, settings, chars);
    for (const code of ['MARKET', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const acc = await prisma.account.create({ data: { email: `cours-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'eleve', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'universite', energy: 100, hunger: 100, wallet: { create: {} } },
      include: { wallet: true },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 100_000n }] }));
    account = acc.id;
    character = c.id;
    day = gameTimeAt(await settings.clock(), Date.now()).day + 1;
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
  });

  it('on paie une fois à l’inscription, puis on suit le cours jusqu’au bout avant la question', async () => {
    await at(10);
    await school.enroll(account, 'compta');
    const wallet = await prisma.wallet.findFirstOrThrow({ where: { character: { id: character } } });
    expect(wallet.balance).toBe(85_000n);

    await expect(school.sit(account, 'compta')).rejects.toThrow('not_class_time');
    await at(18, 5);
    await school.sit(account, 'compta');
    expect((await school.list(account)).find((c) => c.id === 'compta')?.seated).toBe(true);
    // Sortir puis revenir pendant le cours : on reprend sa place
    await school.sit(account, 'compta');
    await at(19, 30);
    await expect(school.attend(account, 'compta', 1)).rejects.toThrow('class_not_over');
    await at(20, 0);
    const r = await school.attend(account, 'compta', 1);
    expect(r.result).toMatchObject({ correct: true, session: 1 });
    await expect(school.sit(account, 'compta')).rejects.toThrow('already_attended_today');
    // Aucune autre somme prélevée pendant les séances
    expect((await prisma.wallet.findFirstOrThrow({ where: { id: wallet.id } })).balance).toBe(85_000n);
  });

  it('trop en retard, on n’entre plus ; sans être entré en classe, pas de question', async () => {
    day += 1;
    await prisma.character.update({ where: { id: character }, data: { energy: 100, hunger: 100 } });
    await at(18, 45);
    await expect(school.sit(account, 'compta')).rejects.toThrow('class_too_late');
    await at(20, 5);
    await expect(school.attend(account, 'compta', 0)).rejects.toThrow('not_seated');
  });
});
