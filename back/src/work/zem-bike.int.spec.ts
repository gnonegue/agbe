import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { WorkService } from './work.service';

// Séance de zém : la moto vient de Gozem (location), du joueur (carburant, usure) ou d'un propriétaire (contrat à versement fixe).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Moto d’une séance de zém (PostgreSQL)', () => {
  let prisma: PrismaService;
  let svc: WorkService;
  let accountId: string;
  let characterId: string;
  let walletId: string;
  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
  const reset = async () => {
    await prisma.workShift.deleteMany({ where: { characterId } });
    await prisma.character.update({ where: { id: characterId }, data: { jobWorkedAt: {}, energy: 100, hunger: 100, hygiene: 100, health: 100, locationId: 'station_zem' } });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    svc = new WorkService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await prisma.venue.upsert({
      where: { id: 'station_zem' },
      create: { id: 'station_zem', emoji: '🛵', nameFr: 'Gozem', nameEn: 'Gozem', districtFr: '-', districtEn: '-', descFr: '-', descEn: '-', x: 0, z: 0 },
      update: { enabled: true },
    });
    await prisma.job.upsert({
      where: { id: 'zem_driver' },
      create: { id: 'zem_driver', level: 'DEBROUILLE', nameFr: 'Conducteur de zém', nameEn: 'Zém driver', payPerShift: 3_500, energyCost: 12, hungerCost: 15, hygieneCost: 15, shiftGameHours: 6 },
      update: { enabled: true },
    });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `zem-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Zémidjan', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'station_zem', jobId: 'zem_driver', energy: 100, wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    characterId = c.id;
    walletId = c.wallet!.id;
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: walletId, amount: 100_000n }] }));
  });

  beforeEach(reset);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('exige de choisir la moto', async () => {
    await expect(svc.start(accountId, 'job')).rejects.toThrow('bike_required');
  });

  it('moto Gozem : la location est prélevée une fois, au démarrage de la séance', async () => {
    const before = await bal();
    const r = await svc.start(accountId, 'job', 'GOZEM');
    expect(r.result.missions).toBeGreaterThan(0);
    expect(await bal()).toBe(before - 1_500n);
  });

  it('moto confiée : refusée sans contrat, puis le versement fixe est prélevé', async () => {
    await expect(svc.start(accountId, 'job', 'OWNER')).rejects.toThrow('no_zem_contract');
    await svc.zemContract(accountId, 'sign');
    await expect(svc.zemContract(accountId, 'sign')).rejects.toThrow('zem_contract_exists');
    const before = await bal();
    await svc.start(accountId, 'job', 'OWNER');
    expect(await bal()).toBe(before - 2_000n);
  });

  it('le contrat se signe et se rompt à la station seulement', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'marche_assigame' } });
    await expect(svc.zemContract(accountId, 'end')).rejects.toThrow('work_at_station_zem');
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'station_zem' } });
    await svc.zemContract(accountId, 'end');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).zemContractAt).toBeNull();
    await expect(svc.zemContract(accountId, 'end')).rejects.toThrow('no_zem_contract');
  });

  it('moto personnelle : rien à verser, mais du carburant et de l’usure', async () => {
    await expect(svc.start(accountId, 'job', 'OWN')).rejects.toThrow('no_moto');
    const v = await prisma.ownedVehicle.create({ data: { characterId, modelId: 'moto_haojue', kind: 'MOTO', fuelMl: 5_000, boughtPrice: 600_000 } });
    const before = await bal();
    await svc.start(accountId, 'job', 'OWN');
    expect(await bal()).toBe(before);
    const after = await prisma.ownedVehicle.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.fuelMl).toBe(5_000 - 25 * 28);
    expect(after.odometerM).toBe(25_000);
    await reset();
    await prisma.ownedVehicle.update({ where: { id: v.id }, data: { fuelMl: 100 } });
    await expect(svc.start(accountId, 'job', 'OWN')).rejects.toThrow('out_of_fuel');
  });

  it('un solde insuffisant annule la séance sans rien prélever', async () => {
    await prisma.workShift.deleteMany({ where: { characterId } });
    const ledger = new LedgerService(prisma);
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    const left = await bal();
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: walletId, to: market, amount: left - 1_000n }] }));
    await expect(svc.start(accountId, 'job', 'GOZEM')).rejects.toThrow('insufficient_funds');
    expect(await bal()).toBe(1_000n);
    expect(await prisma.workShift.count({ where: { characterId } })).toBe(0);
  });
});
