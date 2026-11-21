import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { HomeService } from './home.module';

// Achat, déplacement et revente de meubles (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Aménagement du logement (PostgreSQL)', () => {
  let prisma: PrismaService;
  let svc: HomeService;
  let ledger: LedgerService;
  const p = { account: '', character: '', wallet: '' };
  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: p.wallet } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    svc = new HomeService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const acc = await prisma.account.create({ data: { email: `home-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Maitre', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: 'home', wallet: { create: {} } },
      include: { wallet: true },
    });
    Object.assign(p, { account: acc.id, character: c.id, wallet: c.wallet!.id });
    const m = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: m, to: p.wallet, amount: 2_000_000n }] }));
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('donne les meubles d’origine une seule fois, puis achète, déplace et revend (60 % du prix payé)', async () => {
    const v0 = await svc.view(p.account);
    expect(v0.custom).toBe(true);
    expect(v0.items.length).toBe(7);
    expect((await svc.view(p.account)).items.length).toBe(7); // pas de second cadeau
    const start = await balance();
    const r = await svc.place(p.account, { itemId: 'canape', x: -1.5, z: 2.2, rot: 0 });
    expect(r.result.paid).toBe('180000');
    expect(start - (await balance())).toBe(180_000n);
    await expect(svc.place(p.account, { itemId: 'canape', x: 5, z: 0, rot: 0 })).rejects.toThrow('out_of_room');
    await expect(svc.place(p.account, { itemId: 'fauteuil', x: -1, z: 2.2, rot: 0 })).rejects.toThrow('furniture_overlap');
    await expect(svc.place(p.account, { itemId: 'lit_double', x: 0, z: 2.5, rot: 1 })).rejects.toThrow('fixed_rotation');
    await svc.place(p.account, { itemId: 'tapis', x: -1.5, z: 2.2, rot: 0 }); // un tapis se glisse sous le canapé
    await svc.move(p.account, r.result.id!, { x: -2.5, z: 1.2, rot: 1 });
    const v = await svc.view(p.account);
    expect(v.items.find((i) => i.id === r.result.id)).toMatchObject({ x: -2.5, z: 1.2, rot: 1 });
    const before = await balance();
    const sold = await svc.sell(p.account, r.result.id!);
    expect(sold.result.received).toBe('108000');
    expect((await balance()) - before).toBe(108_000n);
    await expect(svc.sell(p.account, r.result.id!)).rejects.toThrow('unknown_furniture');
  });

  it('un meuble d’origine se range, se repose et se revend à valeur réduite (15 % du catalogue)', async () => {
    const v = await svc.view(p.account);
    const chair = v.items.find((i) => i.itemId === 'chaise')!;
    await svc.store(p.account, chair.id);
    let w = await svc.view(p.account);
    expect(w.items.find((i) => i.id === chair.id)).toBeUndefined();
    expect(w.storage.map((i) => i.id)).toContain(chair.id);
    await svc.placeStored(p.account, chair.id, { x: -2.5, z: 2.8, rot: 0 });
    w = await svc.view(p.account);
    expect(w.items.find((i) => i.id === chair.id)).toMatchObject({ x: -2.5, z: 2.8 });
    await svc.store(p.account, chair.id);
    const before = await balance();
    const sold = await svc.sell(p.account, chair.id); // 8 000 × 25 % × 60 % = 1 200
    expect(sold.result.received).toBe('1200');
    expect((await balance()) - before).toBe(1_200n);
  });

  it('donne un meuble à un autre joueur (rangement du destinataire, valeur réduite), pas à soi-même', async () => {
    const acc = await prisma.account.create({ data: { email: `home2-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const friend = await prisma.character.create({ data: { accountId: acc.id, name: 'Amie', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: 'home', wallet: { create: {} } } });
    const bought = await svc.place(p.account, { itemId: 'plante', x: -1, z: 3, rot: 0 }); // payée 15 000
    await expect(svc.gift(p.account, bought.result.id!, p.character)).rejects.toThrow('gift_self');
    await svc.gift(p.account, bought.result.id!, friend.id);
    const row = await prisma.homeItem.findUniqueOrThrow({ where: { id: bought.result.id! } });
    expect(row).toMatchObject({ characterId: friend.id, housing: 'STORAGE', paid: 3750 }); // 15 000 × 25 %
    expect((await svc.view(p.account)).items.find((i) => i.id === bought.result.id)).toBeUndefined();
    await expect(svc.gift(p.account, bought.result.id!, friend.id)).rejects.toThrow('unknown_furniture');
  });

  it('limite les emplacements du logement', async () => {
    const v = await svc.view(p.account);
    const missing = v.slots - v.items.length;
    await prisma.homeItem.createMany({ data: Array.from({ length: missing }, () => ({ characterId: p.character, housing: v.housing, itemId: 'plante', x: 0, z: 0, rot: 0, paid: 0 })) });
    await expect(svc.place(p.account, { itemId: 'plante', x: 3, z: 3, rot: 0 })).rejects.toThrow('no_free_slot');
  });
});
