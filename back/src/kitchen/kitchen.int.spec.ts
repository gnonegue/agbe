import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { KitchenService } from './kitchen.module';

// Cuisine : courses, appareils, cuisson, restes, péremption (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Cuisine (PostgreSQL)', () => {
  let prisma: PrismaService;
  let kitchen: KitchenService;
  let ledger: LedgerService;
  let account = '';
  let character = '';
  let wallet = '';
  const at = (locationId: string) => prisma.character.update({ where: { id: character }, data: { locationId, hunger: 20, energy: 60, morale: 40 } });
  const qty = async (itemId: string) => (await prisma.pantryLot.aggregate({ where: { characterId: character, itemId }, _sum: { qty: true } }))._sum.qty ?? 0;
  const buyAll = async (ids: [string, number][]) => {
    await at('marche_assigame');
    for (const [id, n] of ids) await kitchen.buy(account, id, n);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    await prisma.gameSetting.deleteMany({ where: { key: 'kitchen' } });
    kitchen = new KitchenService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    for (const code of ['MARKET', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await prisma.foodItem.upsert({ where: { id: 'akoume' }, create: { id: 'akoume', nameFr: 'Akoumé', nameEn: 'Akoumé', price: 500, hunger: 35, energy: 5, morale: 4 }, update: {} });
    const acc = await prisma.account.create({ data: { email: `cuisine-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'cuisinier', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'home', wallet: { create: {} } },
      include: { wallet: true },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 2_000_000n }] }));
    account = acc.id;
    character = c.id;
    wallet = c.wallet!.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('on n’achète qu’au bon endroit, et le prix vient du serveur', async () => {
    await at('home');
    await expect(kitchen.buy(account, 'gombo', 1)).rejects.toThrow('not_at_shop');
    await at('marche_assigame');
    const before = (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;
    await kitchen.buy(account, 'gombo', 1);
    const after = (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;
    expect(before - after).toBe(300n);
    expect(await qty('gombo')).toBe(2); // un achat = un tas de 2
    await expect(kitchen.buy(account, 'gaz', 1)).rejects.toThrow('not_at_shop'); // le gaz se vend à la station
  });

  it('sans réchaud ni ingrédients, on ne cuisine pas', async () => {
    await at('home');
    await expect(kitchen.cook(account, 'r_akoume', 'stove_charcoal')).rejects.toThrow('no_appliance');
    await at('supermarche');
    await kitchen.buyAppliance(account, 'stove_charcoal');
    await expect(kitchen.buyAppliance(account, 'stove_charcoal')).rejects.toThrow('already_owned');
    await at('home');
    await expect(kitchen.cook(account, 'r_akoume', 'stove_charcoal')).rejects.toThrow('missing_ingredient');
  });

  it('cuisiner consomme ingrédients et charbon, nourrit tout de suite et laisse des restes', async () => {
    await buyAll([['farine_mais', 1], ['poisson', 1], ['huile', 1], ['piment', 1], ['epices', 1], ['charbon', 1]]);
    await at('home');
    const r = await kitchen.cook(account, 'r_akoume', 'stove_charcoal');
    expect(r.result).toMatchObject({ food: 'akoume', portions: 4, leftovers: 3 });
    const c = await prisma.character.findUniqueOrThrow({ where: { id: character } });
    expect(c.hunger).toBeGreaterThan(20);
    expect(await qty('charbon')).toBe(7); // 8 cuissons - 1
    expect(await qty('farine_mais')).toBe(1); // 2 - 1
    expect(await qty('gombo')).toBe(0);
    expect(await qty('dish_akoume')).toBe(3);
  });

  it('on mange les restes, ou on les met au congélateur', async () => {
    await at('home');
    await kitchen.eatDish(account, 'akoume');
    expect(await qty('dish_akoume')).toBe(2);
    await expect(kitchen.freezeDish(account, 'akoume', 1)).rejects.toThrow('no_freezer');
    await prisma.character.update({ where: { id: character }, data: { hasFreezer: true } });
    await kitchen.freezeDish(account, 'akoume', 2);
    expect(await qty('dish_akoume')).toBe(0);
    expect((await prisma.freezerItem.findUniqueOrThrow({ where: { characterId_foodId: { characterId: character, foodId: 'akoume' } } })).qty).toBe(2);
    await expect(kitchen.eatDish(account, 'akoume')).rejects.toThrow('no_dish');
  });

  it('le réfrigérateur allonge la conservation et les produits périmés disparaissent', async () => {
    await buyAll([['tomate', 1]]);
    const noFridge = (await prisma.pantryLot.findFirstOrThrow({ where: { characterId: character, itemId: 'tomate' } })).expiresAt!.getTime() - Date.now();
    await at('supermarche');
    await kitchen.buyAppliance(account, 'fridge');
    await at('marche_assigame');
    await kitchen.buy(account, 'oignon', 1);
    const lot = await prisma.pantryLot.findFirstOrThrow({ where: { characterId: character, itemId: 'oignon' } });
    // oignon : 14 jours de jeu, ×3 avec réfrigérateur ; tomate : 5 jours sans (ratio de durée par jour de jeu)
    expect((lot.expiresAt!.getTime() - Date.now()) / 14).toBeGreaterThan((noFridge / 5) * 2.5);
    // un lot périmé est jeté à la prochaine action
    await prisma.pantryLot.create({ data: { characterId: character, itemId: 'piment', qty: 5, expiresAt: new Date(Date.now() - 1000) } });
    await kitchen.buy(account, 'piment', 1);
    expect(await qty('piment')).toBe(5); // 2 restants + 3 du nouvel achat ; les 5 périmés sont jetés
  });
  it('« tout acheter » d’une recette : un seul prélèvement, seulement ce qui manque, d’où qu’on soit', async () => {
    await prisma.pantryLot.deleteMany({ where: { characterId: character } });
    await at('marche_assigame');
    await kitchen.buy(account, 'farine_mais', 1); // déjà en stock : ne doit pas être racheté
    await at('home'); // pas besoin d'être au marché : l'achat est livré à la maison
    const before = (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;
    const r = await kitchen.buyRecipe(account, 'r_akoume');
    const after = (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;
    expect(before - after).toBe(BigInt((r.result as { paid: string }).paid));
    expect(await qty('farine_mais')).toBe(2);
    for (const id of ['gombo', 'poisson', 'huile', 'piment', 'epices']) expect(await qty(id)).toBeGreaterThan(0);
    await expect(kitchen.buyRecipe(account, 'r_akoume')).rejects.toThrow('nothing_to_buy');
  });
});
