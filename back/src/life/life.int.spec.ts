import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { LifeService } from './life.service';
import { HotelService } from '../hotel/hotel.service';
import { gameTimeAt } from '../economy/clock';

// Vie quotidienne : maladie, soins avec l'AMU, famille, cérémonies, coupures (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Vie quotidienne (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let chars: CharacterService;
  let svc: LifeService;
  const P: { account: string; character: string; wallet: string }[] = [];
  const bal = async (i: number) => (await prisma.wallet.findUniqueOrThrow({ where: { id: P[i]!.wallet } })).balance;
  const today = async () => gameTimeAt(await settings.clock(), Date.now()).day;
  const set = (key: string, value: object) => prisma.gameSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    svc = new LifeService(prisma, ledger, settings, chars, new HotelService(prisma, ledger, settings, chars));
    await set('venues.hours', {});
    // Tout arrive à coup sûr : maladie, demande de la famille, coupures
    await set('health.rules', { dailyRiskBp: 10_000, dirtyBelow: 30, dirtyMultiplierBp: 20_000, weakBelow: 40, weakMultiplierBp: 15_000, consultPrice: 2_500, healOnTreat: 30, maxCatchUpDays: 7 });
    await set('health.illnesses', [{ id: 'paludisme', nameFr: 'Paludisme', nameEn: 'Malaria', weight: 1, dailyHealth: 8, dailyEnergy: 10, treatment: 3_000, selfHealDays: 0 }]);
    await set('utilities.outages', { powerDailyBp: 10_000, powerHours: [5, 5], powerMorale: 4, waterDailyBp: 10_000, waterHours: [5, 5], waterHygiene: 10, generatorPrice: 85_000, solarPrice: 250_000, tankPrice: 60_000 });
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    const tag = Date.now().toString(36);
    for (const n of ['Hôte', 'Invité']) {
      const acc = await prisma.account.create({ data: { email: `life-${n.length}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const c = await prisma.character.create({ data: { accountId: acc.id, name: n, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'MIDDLE', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', wallet: { create: {} } }, include: { wallet: true } });
      await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 500_000n }] }));
      P.push({ account: acc.id, character: c.id, wallet: c.wallet!.id });
    }
  });

  afterAll(async () => {
    // Réglages forcés pour le test : retour aux valeurs par défaut
    await prisma?.gameSetting.deleteMany({ where: { key: { in: ['health.rules', 'health.illnesses', 'utilities.outages', 'family.rules', 'ceremony.rules'] } } });
    await prisma?.$disconnect();
  });

  it('un jour passe : maladie, demande de la famille et coupures ; soins à l’hôpital avec l’AMU', async () => {
    await set('family.rules', { dailyRequestBp: 10_000, answerDays: 3, requests: [{ id: 'scolarite', amount: { POOR: 5_000, MIDDLE: 15_000, RICH: 50_000 }, paidRespect: 6, paidMorale: 4, refusedRespect: 6, refusedMorale: 6 }], helpBelow: 0, helpChanceBp: { POOR: 0, MIDDLE: 0, RICH: 0 }, helpAmount: { POOR: 0, MIDDLE: 0, RICH: 0 } });
    await prisma.character.update({ where: { id: P[0]!.character }, data: { lifeCheckedDay: (await today()) - 1, locationId: 'home' } });
    const s = await chars.state(P[0]!.account);
    expect(s.illness).toBeNull(); // l'état ne fait pas passer le temps : il faut une action
    await chars.act(P[0]!.account, async () => null); // une action fait passer le temps
    await expect(svc.consult(P[0]!.account)).rejects.toThrow('not_at_hospital');
    const st = (await svc.family(P[0]!.account))[0]!;
    expect(st).toMatchObject({ kind: 'scolarite', amount: '15000', status: 'PENDING' });
    const after = await chars.state(P[0]!.account);
    expect(after.illness).toEqual({ id: null, sinceDay: await today(), diagnosed: false });
    expect(after.outages.power && after.outages.water).toBe(true);

    // Sans AMU : consultation et traitement au prix plein ; avec l'AMU, 80 % remboursés
    await prisma.character.update({ where: { id: P[0]!.character }, data: { locationId: 'chu', amuPaidUntilGameDay: (await today()) + 30 } });
    await expect(svc.treat(P[0]!.account)).rejects.toThrow('consult_first');
    const b = await bal(0);
    const c = (await svc.consult(P[0]!.account)).result;
    // Consultation : examen et demandes d'analyses, sans diagnostic tant que les résultats ne sont pas là
    expect(c).toMatchObject({ paid: '500', visit: { status: 'CONSULTED', interpretation: null, prescription: null } });
    expect(c.visit!.analyses.map((a) => a.id)).toEqual(['tdr_palu', 'goutte_epaisse', 'nfs']);
    await expect(svc.treat(P[0]!.account)).rejects.toThrow('consult_first');
    // Analyses (5 200 × 20 % = 1 040), puis interprétation et ordonnance
    const a = (await svc.analyses(P[0]!.account)).result;
    expect(a).toMatchObject({ paid: '1040', visit: { status: 'ANALYZED', interpretation: { illness: 'paludisme' }, prescription: { total: 3_000, patientTotal: '600' } } });
    expect(a.visit!.analyses.find((x) => x.id === 'tdr_palu')!.result).toMatchObject({ valueFr: 'Positif', flag: 'positive' });
    expect((await chars.state(P[0]!.account)).illness).toMatchObject({ id: 'paludisme', diagnosed: true });
    await svc.treat(P[0]!.account);
    expect(await bal(0)).toBe(b - 2_140n);
    expect((await chars.state(P[0]!.account)).illness).toBeNull();

    // Répondre à la famille
    const b2 = await bal(0);
    await svc.answerFamily(P[0]!.account, (await prisma.familyRequest.findFirstOrThrow({ where: { characterId: P[0]!.character } })).id, true);
    expect(await bal(0)).toBe(b2 - 15_000n);
  });

  it('cérémonie : l’hôte paie la fête, l’invité présent le jour dit fait un don', async () => {
    await set('family.rules', { dailyRequestBp: 0, answerDays: 3, requests: [{ id: 'scolarite', amount: { POOR: 1, MIDDLE: 1, RICH: 1 }, paidRespect: 0, paidMorale: 0, refusedRespect: 0, refusedMorale: 0 }], helpBelow: 0, helpChanceBp: { POOR: 0, MIDDLE: 0, RICH: 0 }, helpAmount: { POOR: 0, MIDDLE: 0, RICH: 0 } });
    await set('ceremony.rules', { kinds: { DOT: { cost: 150_000, respect: 25 }, BAPTEME: { cost: 40_000, respect: 10 }, FUNERAILLES: { cost: 200_000, respect: 30 }, ANNIVERSAIRE: { cost: 15_000, respect: 5 } }, minGift: 500, maxGift: 20_000, guestRespect: 3, guestMorale: 6, minDaysAhead: 0, maxDaysAhead: 30, maxPerMonth: 2, venues: ['plage_lome'] });
    await prisma.venue.upsert({ where: { id: 'plage_lome' }, create: { id: 'plage_lome', emoji: '🛒', nameFr: 'Grand Marché', nameEn: 'Grand Market', districtFr: 'Assigamé', districtEn: 'Assigamé', descFr: '-', descEn: '-', x: 0, z: 0 }, update: {} });
    await expect(svc.organize(P[0]!.account, 'BAPTEME', 'marche_assigame', 0)).rejects.toThrow('ceremony_bad_venue');
    const b = await bal(0);
    const id = (await svc.organize(P[0]!.account, 'BAPTEME', 'plage_lome', 0)).result.ceremony!;
    expect(await bal(0)).toBe(b - 40_000n);
    await prisma.character.update({ where: { id: P[1]!.character }, data: { locationId: 'home' } });
    await expect(svc.attend(P[1]!.account, id, 2_000)).rejects.toThrow('not_at_ceremony');
    await prisma.character.update({ where: { id: P[1]!.character }, data: { locationId: 'plage_lome' } });
    await expect(svc.attend(P[1]!.account, id, 50_000)).rejects.toThrow('gift_out_of_bounds');
    const h = await bal(0);
    await svc.attend(P[1]!.account, id, 2_000);
    expect(await bal(0)).toBe(h + 2_000n);
    await expect(svc.attend(P[1]!.account, id, 2_000)).rejects.toThrow('already_attended');
    await expect(svc.cancelCeremony(P[0]!.account, id)).rejects.toThrow('ceremony_has_guests');
  });

  it('équipement : un groupe électrogène ne s’achète qu’une fois', async () => {
    await svc.equip(P[1]!.account, 'generator');
    await expect(svc.equip(P[1]!.account, 'generator')).rejects.toThrow('already_equipped');
    expect((await chars.state(P[1]!.account)).equipment.generator).toBe(true);
    expect((await ledger.verify()).ok).toBe(true);
  });
});
