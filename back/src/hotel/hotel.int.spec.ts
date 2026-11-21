import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { HotelService } from './hotel.service';

// Hôtel : chambres limitées, séjour, sommeil sur place, service en chambre, salles (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Hôtel (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let chars: CharacterService;
  let svc: HotelService;
  const P: { account: string; character: string; wallet: string }[] = [];
  const bal = async (i: number) => (await prisma.wallet.findUniqueOrThrow({ where: { id: P[i]!.wallet } })).balance;
  const hotel = {
    venueId: 'hotel_test',
    maxNights: 14,
    rooms: [{ id: 'suite', count: 1, nightly: 100_000, comfort: 10 }],
    roomService: [{ id: 'petit_dej', emoji: '🥐', nameFr: 'Petit-déjeuner', nameEn: 'Breakfast', price: 6_000, hunger: 25, energy: 8, morale: 5, health: 1 }],
    halls: [{ id: 'salle_reunion', capacity: 30, daily: 150_000, respect: 3 }],
    partyHall: 'salle_reunion',
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    svc = new HotelService(prisma, ledger, settings, chars);
    await prisma.gameSetting.upsert({ where: { key: 'hotel' }, create: { key: 'hotel', value: hotel }, update: { value: hotel } });
    await prisma.gameSetting.upsert({ where: { key: 'venues.hours' }, create: { key: 'venues.hours', value: {} }, update: { value: {} } });
    await prisma.hotelStay.deleteMany({ where: { venueId: 'hotel_test' } });
    await prisma.hallBooking.deleteMany({ where: { venueId: 'hotel_test' } });
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    const tag = Date.now().toString(36);
    for (const n of ['Client', 'Autre']) {
      const acc = await prisma.account.create({ data: { email: `hotel-${n}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const c = await prisma.character.create({ data: { accountId: acc.id, name: n, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'RICH', birthMode: 'FREE_CHOICE', housing: 'VILLA', locationId: 'home', wallet: { create: {} } }, include: { wallet: true } });
      await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 1_000_000n }] }));
      P.push({ account: acc.id, character: c.id, wallet: c.wallet!.id });
    }
  });

  afterAll(async () => {
    await prisma?.gameSetting.deleteMany({ where: { key: 'hotel' } });
    await prisma?.$disconnect();
  });

  it('réserve la dernière suite, refuse la seconde, prolonge, sert en chambre seulement sur place', async () => {
    await svc.book(P[0]!.account, 'suite', 2);
    expect(await bal(0)).toBe(800_000n);
    await expect(svc.book(P[1]!.account, 'suite', 1)).rejects.toThrow('hotel_full');
    await svc.book(P[0]!.account, 'suite', 1); // prolongation
    expect((await svc.view(P[0]!.account)).stay?.nightsLeft).toBe(3);
    await expect(svc.order(P[0]!.account, 'petit_dej')).rejects.toThrow('not_at_hotel');
    await prisma.character.update({ where: { id: P[0]!.character }, data: { locationId: 'hotel_test' } });
    await svc.order(P[0]!.account, 'petit_dej');
    expect(await bal(0)).toBe(800_000n - 100_000n - 6_000n);
    // Repos dans la chambre (pas « à la maison »)
    await prisma.character.update({ where: { id: P[1]!.character }, data: { locationId: 'hotel_test' } });
    await expect(chars.rest(P[1]!.account)).rejects.toThrow('not_at_home');
    await chars.rest(P[0]!.account).catch((e: Error) => expect(e.message).not.toBe('not_at_home'));
    await prisma.character.updateMany({ where: { id: P[0]!.character }, data: { sleepUntil: null } }); // la sieste ne doit pas bloquer la suite du test
    // Départ : la suite se libère
    await svc.checkout(P[0]!.account);
    await svc.book(P[1]!.account, 'suite', 1);
  });

  it('une salle ne se loue qu’une fois par jour', async () => {
    await svc.bookHall(P[0]!.account, 'salle_reunion', 3);
    await expect(svc.bookHall(P[1]!.account, 'salle_reunion', 3)).rejects.toThrow('hall_taken');
    expect((await ledger.verify()).ok).toBe(true);
  });
});
