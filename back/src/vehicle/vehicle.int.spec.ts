import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { VehicleService } from './vehicle.module';

// Moto et voiture : achat, plein, trajets (carburant, usure, panne si entretien dépassé), entretien, revente.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Concession, carburant et entretien (PostgreSQL)', () => {
  let prisma: PrismaService;
  let chars: CharacterService;
  let svc: VehicleService;
  let accountId: string;
  let characterId: string;
  let walletId: string;
  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
  const venue = (id: string, x: number, z: number) =>
    prisma.venue.upsert({ where: { id }, create: { id, emoji: '⛽', nameFr: id, nameEn: id, districtFr: '-', districtEn: '-', descFr: '-', descEn: '-', x, z }, update: { x, z, enabled: true } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    svc = new VehicleService(prisma, ledger, settings, chars);
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await venue('station_oryx', 0, 0);
    await venue('v_loin', 500, 0); // 50 km
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `veh-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Motard', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'station_oryx', energy: 100, wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    characterId = c.id;
    walletId = c.wallet!.id;
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: walletId, amount: 5_000_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('achète une moto (demi-réservoir), pas plus de véhicules que le garage n’en contient', async () => {
    const before = await bal();
    const r = await svc.buy(accountId, 'moto_haojue');
    expect(r.result).toMatchObject({ paid: 600_000 });
    expect(await bal()).toBe(before - 600_000n);
    const g = await svc.garage(accountId);
    expect(g.mine).toHaveLength(1);
    expect(g.mine[0]).toMatchObject({ modelId: 'moto_haojue', fuelMl: 5_000, condition: 100, serviceDue: false });
    await expect(svc.buy(accountId, 'inconnu')).rejects.toThrow('unknown_model');
    await svc.buy(accountId, 'moto_sanya');
    await svc.buy(accountId, 'moto_sanya');
    await expect(svc.buy(accountId, 'moto_sanya')).rejects.toThrow('garage_full');
    // Les deux Sanya sont revendues pour libérer le garage
    for (const v of (await svc.garage(accountId)).mine.filter((x) => x.modelId === 'moto_sanya')) await svc.sell(accountId, v.id);
    expect((await svc.garage(accountId)).mine).toHaveLength(1);
  });

  it('fait le plein à la station : litres × prix, jamais au-delà du réservoir', async () => {
    const v = (await svc.garage(accountId)).mine[0]!;
    const price = (await svc.garage(accountId)).fuelPricePerL;
    const before = await bal();
    const r = await svc.refuel(accountId, v.id, 50);
    expect(r.result).toMatchObject({ liters: 5, paid: 5 * price }); // 10 L de réservoir, 5 L restants
    expect(await bal()).toBe(before - BigInt(5 * price));
    await expect(svc.refuel(accountId, v.id, 5)).rejects.toThrow('tank_full');
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'v_loin' } });
    await expect(svc.refuel(accountId, v.id, 1)).rejects.toThrow('not_at_station');
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'station_oryx' } });
  });

  it('panne sèche loin d’une station : plein livré à distance, plus cher (litre majoré + frais de livraison)', async () => {
    const v = (await svc.garage(accountId)).mine[0]!;
    await prisma.ownedVehicle.update({ where: { id: v.id }, data: { fuelMl: 0 } });
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'v_loin' } });
    const g = await svc.garage(accountId);
    expect(g.remoteFuel.pricePerL).toBeGreaterThan(g.fuelPricePerL);
    const before = await bal();
    const r = await svc.refuel(accountId, v.id, 3, undefined, true);
    expect(r.result).toMatchObject({ liters: 3, paid: 3 * g.remoteFuel.pricePerL + g.remoteFuel.fee, remote: true });
    expect(r.result.paid).toBeGreaterThan(3 * g.fuelPricePerL);
    expect(await bal()).toBe(before - BigInt(r.result.paid));
    expect((await prisma.ownedVehicle.findUniqueOrThrow({ where: { id: v.id } })).fuelMl).toBe(3000);
    await prisma.ownedVehicle.update({ where: { id: v.id }, data: { fuelMl: 10_000 } });
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'station_oryx' } });
  });

  it('un trajet en moto consomme du carburant et de l’usure, sans tarif', async () => {
    const v = (await svc.garage(accountId)).mine[0]!;
    const before = await bal();
    const r = await chars.travel(accountId, 'v_loin', 'MOTO', undefined, v.id);
    expect(r.result).toMatchObject({ mode: 'MOTO', paid: '0', meters: 50_000, fuelUsedMl: 1_400, breakdown: false }); // 50 km × 28 ml
    expect(await bal()).toBe(before);
    const after = (await svc.garage(accountId)).mine[0]!;
    expect(after).toMatchObject({ fuelMl: 10_000 - 1_400, odometerKm: 50, sinceServiceKm: 50 });
    await expect(chars.travel(accountId, 'station_oryx', 'CAR')).rejects.toThrow('no_car');
  });

  it('refuse de partir sans assez de carburant ; l’entretien dépassé expose aux pannes, la réparation et l’entretien remettent à neuf', async () => {
    const v = (await svc.garage(accountId)).mine[0]!;
    await prisma.ownedVehicle.update({ where: { id: v.id }, data: { fuelMl: 100 } });
    await expect(chars.travel(accountId, 'station_oryx', 'MOTO', undefined, v.id)).rejects.toThrow('out_of_fuel');
    // Entretien dépassé d'un demi-intervalle : 12,5 % de risque de panne par trajet ; on répète jusqu'à la panne
    let broke = false;
    for (let i = 0; i < 80 && !broke; i++) {
      await prisma.ownedVehicle.update({ where: { id: v.id }, data: { fuelMl: 10_000, sinceServiceM: 1_500_000, damage: 0 } });
      const loc = (await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).locationId;
      const r = await chars.travel(accountId, loc === 'station_oryx' ? 'v_loin' : 'station_oryx', 'MOTO', undefined, v.id);
      broke = r.result.breakdown;
    }
    expect(broke).toBe(true);
    const sick = (await svc.garage(accountId)).mine[0]!;
    expect(sick.damage).toBeGreaterThan(0);
    // À la station : réparation (prix ∝ dégâts) puis entretien
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'station_oryx' } });
    const b = await bal();
    const rep = await svc.repair(accountId, v.id);
    expect(rep.result.paid).toBe(Math.ceil((45_000 * sick.damage) / 100));
    expect(await bal()).toBe(b - BigInt(rep.result.paid));
    const sv = await svc.service(accountId, v.id);
    expect(sv.result.paid).toBe(15_000);
    expect((await svc.garage(accountId)).mine[0]).toMatchObject({ damage: 0, sinceServiceKm: 0, serviceDue: false, condition: 100 });
    await expect(svc.service(accountId, v.id)).rejects.toThrow('service_not_needed');
  });

  it('revend le véhicule à sa valeur (kilométrage), une seule fois', async () => {
    const v = (await svc.garage(accountId)).mine[0]!;
    const before = await bal();
    const r = await svc.sell(accountId, v.id);
    expect(r.result.received).toBe(v.resaleValue);
    expect(await bal()).toBe(before + BigInt(v.resaleValue));
    await expect(svc.sell(accountId, v.id)).rejects.toThrow('unknown_vehicle');
    expect((await svc.garage(accountId)).mine).toHaveLength(0);
  });
});
