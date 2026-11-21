import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { LiveService } from '../live/live.service';
import { AuditService } from '../common/audit.service';
import { gameTimeAt } from '../economy/clock';
import { nextConferences } from '../economy/conference';
import { ConferenceService } from './conference.module';

// Conférences : entrée payée une fois, à l'heure ; récompense seulement à la fin ; annonce à la ville.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Conférences (PostgreSQL)', () => {
  let prisma: PrismaService;
  let svc: ConferenceService;
  let settings: SettingsService;
  let live: LiveService;
  let account = '';
  let character = '';
  let wallet = '';
  let day = 0;
  const at = async (hour: number, minute = 0) => {
    const cfg = await settings.clock();
    vi.setSystemTime(cfg.epochRealMs + (((day * 1440 + hour * 60 + minute) * cfg.secondsPerGameDay) / 1440) * 1000 + 500);
  };
  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    await prisma.gameSetting.deleteMany({ where: { key: 'conference' } });
    const chars = new CharacterService(prisma, ledger, settings);
    live = new LiveService(prisma, settings, new AuditService(prisma));
    svc = new ConferenceService(prisma, ledger, settings, chars, live);
    for (const code of ['MARKET', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await prisma.venue.upsert({ where: { id: 'universite' }, create: { id: 'universite', emoji: '🎓', nameFr: 'Université', nameEn: 'University', districtFr: 'Tokoin', districtEn: 'Tokoin', descFr: '-', descEn: '-', x: 0, z: 0 }, update: {} });
    const acc = await prisma.account.create({ data: { email: `conf-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'auditeur', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'universite', energy: 100, hunger: 100, morale: 50, respect: 10, wallet: { create: {} } },
      include: { wallet: true },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 50_000n }] }));
    account = acc.id;
    character = c.id;
    wallet = c.wallet!.id;
    const now = gameTimeAt(await settings.clock(), Date.now());
    day = nextConferences(now.day + 1, 0, await settings.get('conference'), 1)[0]!.day;
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterAll(async () => {
    vi.useRealTimers();
    live?.onModuleDestroy();
    await prisma?.$disconnect();
  });

  it('la ville est prévenue 1 h avant puis au début, une seule fois chacun', async () => {
    const spy = vi.spyOn(live, 'announce');
    await at(17, 10);
    await svc.announceTick();
    await svc.announceTick();
    await at(18, 2);
    await svc.announceTick();
    expect(spy.mock.calls.map((c) => [c[1], c[2].when])).toEqual([['conference', 'soon'], ['conference', 'now']]);
  });

  it('on paie l’entrée une fois, on reste jusqu’à la fin, puis moral et respect', async () => {
    await at(17, 30);
    await expect(svc.sit(account)).rejects.toThrow('not_conference_time');
    await at(18, 10);
    await svc.sit(account);
    expect(await balance()).toBe(48_000n);
    await svc.sit(account); // retour dans la salle : rien n'est repayé
    expect(await balance()).toBe(48_000n);
    expect((await svc.list(account)).upcoming[0]).toMatchObject({ day, seated: true });
    await at(19, 0);
    await expect(svc.finish(account)).rejects.toThrow('conference_not_over');
    await at(20, 0);
    const before = await prisma.character.findUniqueOrThrow({ where: { id: character } });
    await svc.finish(account);
    const after = await prisma.character.findUniqueOrThrow({ where: { id: character } });
    expect(after.respect - before.respect).toBe(3);
    await expect(svc.finish(account)).rejects.toThrow('conference_done');
  });

  it('trop en retard on n’entre plus, et pas de conférence les autres jours', async () => {
    day += (await settings.get('conference')).everyDays;
    await prisma.character.update({ where: { id: character }, data: { energy: 100, hunger: 100 } });
    await at(18, 45);
    await expect(svc.sit(account)).rejects.toThrow('conference_too_late');
    day += 1;
    await at(18, 5);
    await expect(svc.sit(account)).rejects.toThrow('no_conference_today');
  });
});
