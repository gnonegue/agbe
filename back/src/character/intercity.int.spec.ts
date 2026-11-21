import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SETTING_DEFAULTS, SettingsService } from '../settings/settings.service';
import { CharacterService } from './character.service';

// Voyages entre villes en car (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Voyage entre villes (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let chars: CharacterService;
  let settings: SettingsService;
  const setOpen = (enabled: boolean) => settings.set('travel.intercity', { ...SETTING_DEFAULTS['travel.intercity'], enabled }, account);
  let account: string;
  let character: string;
  let wallet: string;
  const venue = (id: string, city: string) =>
    prisma.venue.upsert({ where: { id }, create: { id, city, emoji: '🚌', nameFr: id, nameEn: id, districtFr: '-', districtEn: '-', descFr: '-', descEn: '-', x: 0, z: 0 }, update: { city, enabled: true } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    await prisma.gameSetting.upsert({ where: { key: 'venues.hours' }, create: { key: 'venues.hours', value: {} }, update: { value: {} } });
    await prisma.gameSetting.upsert({ where: { key: 'economy.events' }, create: { key: 'economy.events', value: [] }, update: { value: [] } });
    await venue('agbalepedo', 'lome');
    await venue('gare_kpalime', 'kpalime');
    await venue('marche_kpalime', 'kpalime');
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const acc = await prisma.account.create({ data: { email: `car-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({ data: { accountId: acc.id, name: 'Voyageur', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'MIDDLE', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'home', wallet: { create: {} } }, include: { wallet: true } });
    await prisma.$transaction(async (tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: await ledger.systemWalletId(tx, 'MARKET'), to: c.wallet!.id, amount: 50_000n }] }));
    [account, character, wallet] = [acc.id, c.id, c.wallet!.id];
  });

  afterAll(async () => {
    await prisma?.gameSetting.deleteMany({ where: { key: { in: ['economy.events', 'travel.intercity'] } } });
    await prisma?.$disconnect();
  });

  it('voyages fermés par défaut : on ne quitte pas Lomé, même depuis la gare', async () => {
    await prisma.gameSetting.deleteMany({ where: { key: 'travel.intercity' } });
    await prisma.character.update({ where: { id: character }, data: { locationId: 'agbalepedo' } });
    const before = (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;
    await expect(chars.intercity(account, 'kpalime')).rejects.toThrow('intercity_closed');
    expect((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance).toBe(before);
    await prisma.character.update({ where: { id: character }, data: { locationId: 'home' } });
  });

  it('prend le car à la gare, voyage sans pouvoir agir, arrive dans la ville sans pouvoir rentrer à pied', async () => {
    await setOpen(true);
    await expect(chars.intercity(account, 'kpalime')).rejects.toThrow('not_at_gare');
    await expect(chars.travel(account, 'marche_kpalime', 'ZEM')).rejects.toThrow('other_city');
    await prisma.character.update({ where: { id: character }, data: { locationId: 'agbalepedo' } });
    const before = (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;
    const r = await chars.intercity(account, 'kpalime');
    expect(r.result).toMatchObject({ to: 'kpalime', paid: '2500', hours: 3 });
    expect((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance).toBe(before - 2_500n);
    expect(r.state.city).toBe('kpalime');
    expect(r.state.trip).not.toBeNull();
    await expect(chars.travel(account, 'marche_kpalime', 'WALK')).rejects.toThrow('on_trip');
    // Arrivée
    await prisma.character.update({ where: { id: character }, data: { tripUntil: new Date(Date.now() - 1000) } });
    await chars.travel(account, 'marche_kpalime', 'WALK');
    await expect(chars.travel(account, 'home', 'ZEM')).rejects.toThrow('other_city');
    // Voyages refermés pendant qu'il est à Kpalimé : le retour vers Lomé reste possible
    await setOpen(false);
    await prisma.character.update({ where: { id: character }, data: { locationId: 'gare_kpalime' } });
    const back = await chars.intercity(account, 'lome');
    expect(back.state.city).toBe('lome');
  });
});
