import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { WorkService } from './work.service';

// Parcours zémidjan : devenir zém au plafond de métiers, séance, course servie et payée, changement de métier (PostgreSQL réel).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Parcours zémidjan (PostgreSQL)', () => {
  let prisma: PrismaService;
  let chars: CharacterService;
  let work: WorkService;
  let accountId: string;
  let characterId: string;
  let walletId: string;
  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
  const venue = (id: string, x: number, z: number) =>
    prisma.venue.upsert({ where: { id }, create: { id, emoji: '📍', nameFr: id, nameEn: id, districtFr: '-', districtEn: '-', descFr: '-', descEn: '-', x, z }, update: { enabled: true } });
  const job = (id: string, pay: number) =>
    prisma.job.upsert({ where: { id }, create: { id, level: 'DEBROUILLE', nameFr: id, nameEn: id, payPerShift: pay, energyCost: 10, hungerCost: 10, hygieneCost: 5, shiftGameHours: 6 }, update: { enabled: true } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    work = new WorkService(prisma, ledger, settings, chars);
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await prisma.gameSetting.upsert({ where: { key: 'venues.hours' }, create: { key: 'venues.hours', value: {} }, update: { value: {} } });
    await Promise.all([venue('station_zem', 0, 0), venue('marche_assigame', 300, 40), venue('supermarche', -250, 120), venue('port', 500, -60)]);
    await Promise.all([job('zem_driver', 3_500), job('car_washer', 2_000), job('street_vendor', 2_500), job('delivery_driver', 3_000)]);
    const acc = await prisma.account.create({ data: { email: `zemflow-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Zem Flow', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'station_zem', energy: 100, hunger: 100, hygiene: 100, wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    characterId = c.id;
    walletId = c.wallet!.id;
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('au plafond de 3 métiers, devenir zém remplace le métier actif à la tâche', async () => {
    for (const j of ['car_washer', 'street_vendor', 'delivery_driver']) await chars.takeJob(accountId, j);
    let me = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(me.jobIds).toHaveLength(3);
    await chars.takeJob(accountId, 'zem_driver');
    me = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(me.jobId).toBe('zem_driver');
    expect(me.jobIds).toHaveLength(3);
    expect(me.jobIds).toContain('zem_driver');
    expect(me.jobIds).not.toContain('delivery_driver'); // le métier actif au moment du changement a été remplacé
  });

  it('on peut changer de métier quand on veut, puis redevenir zém', async () => {
    await chars.takeJob(accountId, 'car_washer');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).jobId).toBe('car_washer');
    await chars.takeJob(accountId, 'zem_driver');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).jobId).toBe('zem_driver');
    await chars.quitJob(accountId, 'car_washer');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).jobIds).not.toContain('car_washer');
  });

  it('séance de zém : moto Gozem louée, courses enchaînées, course servie et payée', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { jobWorkedAt: {}, locationId: 'station_zem' } });
    const ledger = new LedgerService(prisma);
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: walletId, amount: 50_000n }] }));
    const before = await bal();
    const started = await work.start(accountId, 'job', 'GOZEM');
    expect(started.result.missions).toBeGreaterThan(1);
    expect(await bal()).toBe(before - 1_500n); // location de la moto
    const shift = await prisma.workShift.findFirstOrThrow({ where: { characterId, closedAt: null } });
    const orders = shift.orders as unknown as { id: string; kind: string; from?: string; to?: string; amount: number; status: string }[];
    expect(orders.every((o) => o.kind === 'ride')).toBe(true);
    expect(orders[0]!.from).toBe('station_zem');
    for (let i = 1; i < orders.length; i++) expect(orders[i]!.from).toBe(orders[i - 1]!.to); // chaque course part du dépôt précédent
    const mid = await bal();
    const served = await work.serve(accountId, shift.id, orders[0]!.id, true);
    expect(served.result.paid).toBeGreaterThan(0);
    expect(await bal()).toBeGreaterThan(mid);
    // Le même client ne paie pas deux fois
    await expect(work.serve(accountId, shift.id, orders[0]!.id, true)).rejects.toThrow('mission_done');
  });
});
