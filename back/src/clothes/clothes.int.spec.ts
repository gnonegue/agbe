import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { ClothesService } from './clothes.module';

// Habillement : achats, garde-robe, tenue, boutique d'un joueur (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Habillement (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let svc: ClothesService;
  const P: { account: string; character: string; wallet: string }[] = [];
  const bal = async (i: number) => (await prisma.wallet.findUniqueOrThrow({ where: { id: P[i]!.wallet } })).balance;
  const at = (i: number, loc: string) => prisma.character.update({ where: { id: P[i]!.character }, data: { locationId: loc } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    svc = new ClothesService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    await prisma.gameSetting.upsert({ where: { key: 'venues.hours' }, create: { key: 'venues.hours', value: {} }, update: { value: {} } });
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    const tag = Date.now().toString(36);
    // Vendeur (homme), cliente (femme), client (homme)
    for (const [n, female] of [['Vendeur', false], ['Cliente', true], ['Client', false]] as const) {
      const acc = await prisma.account.create({ data: { email: `clo-${n}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const look = { female, hair: 'short', outfit: 'casual', fabric: 'plain', skin: 8, hairColor: 0, color: 0 };
      const c = await prisma.character.create({ data: { accountId: acc.id, name: n, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', look, wallet: { create: {} } }, include: { wallet: true } });
      await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 300_000n }] }));
      P.push({ account: acc.id, character: c.id, wallet: c.wallet!.id });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('achat au prix du catalogue, une seule fois, seulement en boutique', async () => {
    await at(2, 'home');
    await expect(svc.buy(P[2]!.account, 'polo_beige')).rejects.toThrow('not_at_clothes_shop');
    await at(2, 'mode_assigame');
    const b = await bal(2);
    await svc.buy(P[2]!.account, 'polo_beige');
    await svc.buy(P[2]!.account, 'jean_bleu');
    expect(await bal(2)).toBe(b - 14_000n);
    await expect(svc.buy(P[2]!.account, 'polo_beige')).rejects.toThrow('garment_already_owned');
    expect(await bal(2)).toBe(b - 14_000n);
  });

  it('tenue composée à la maison, avec les pièces possédées et de la bonne coupe', async () => {
    await expect(svc.wear(P[2]!.account, { top: 'polo_beige', bottom: 'jean_bleu' })).rejects.toThrow('dress_at_home');
    await at(2, 'home');
    await expect(svc.wear(P[2]!.account, { top: 'polo_beige' })).rejects.toThrow('outfit_incomplete');
    await expect(svc.wear(P[2]!.account, { top: 'chemise_blanche', bottom: 'jean_bleu' })).rejects.toThrow('garment_not_owned');
    await svc.wear(P[2]!.account, { top: 'polo_beige', bottom: 'jean_bleu' });
    const c = await prisma.character.findUniqueOrThrow({ where: { id: P[2]!.character } });
    expect((c.look as { wear: unknown; hair: string }).wear).toEqual({ top: 'polo_beige', bottom: 'jean_bleu' });
    expect((c.look as { hair: string }).hair).toBe('short');
    await svc.wear(P[2]!.account, {});
    expect((await prisma.character.findUniqueOrThrow({ where: { id: P[2]!.character } })).look).not.toHaveProperty('wear');
  });

  it('boutique d’un joueur : loyer, gros, prix borné, vente taxée, dernière pièce disputée', async () => {
    await at(0, 'mode_be');
    const b0 = await bal(0);
    await svc.rent(P[0]!.account, 1);
    expect(await bal(0)).toBe(b0 - 7_000n);
    await svc.stock(P[0]!.account, 'robe_wax', 1); // 60 % de 15 000
    expect(await bal(0)).toBe(b0 - 7_000n - 9_000n);
    await expect(svc.setPrice(P[0]!.account, 'robe_wax', 8_999)).rejects.toThrow('price_out_of_bounds');
    await expect(svc.setPrice(P[0]!.account, 'robe_wax', 22_501)).rejects.toThrow('price_out_of_bounds');
    await svc.setPrice(P[0]!.account, 'robe_wax', 20_000);

    const shop = await prisma.clothingShop.findUniqueOrThrow({ where: { characterId: P[0]!.character } });
    await at(1, 'mode_assigame');
    await expect(svc.buyFrom(P[1]!.account, shop.id, 'robe_wax')).rejects.toThrow('not_at_clothing_shop');
    await at(1, 'mode_be');
    await at(2, 'mode_be');
    const st = await svc.state(P[1]!.account);
    expect(st.shops.find((s) => s.id === shop.id)?.items).toEqual([{ itemId: 'robe_wax', qty: 1, price: 20_000 }]);
    await expect(svc.buyFrom(P[0]!.account, shop.id, 'robe_wax')).rejects.toThrow('own_clothing_shop');

    const [s0, s1, s2] = [await bal(0), await bal(1), await bal(2)];
    const r = await Promise.allSettled([svc.buyFrom(P[1]!.account, shop.id, 'robe_wax'), svc.buyFrom(P[2]!.account, shop.id, 'robe_wax')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await bal(1)) + (await bal(2))).toBe(s1 + s2 - 20_000n);
    expect(await bal(0)).toBe(s0 + 19_600n); // taxe 2 %

    // La robe n'est portable que par une femme qui la possède
    const buyer = (await prisma.garment.findMany({ where: { itemId: 'robe_wax', characterId: { in: [P[1]!.character, P[2]!.character] } } }))[0]!;
    expect(buyer.characterId).toBeDefined();
    if (buyer.characterId === P[1]!.character) {
      await at(1, 'home');
      await svc.wear(P[1]!.account, { dress: 'robe_wax' });
    } else {
      await at(2, 'home');
      await expect(svc.wear(P[2]!.account, { dress: 'robe_wax' })).rejects.toThrow('garment_wrong_gender');
    }
    expect((await ledger.verify()).ok).toBe(true);
  });

  it('des clients du quartier achètent seuls et la fermeture rachète le stock et rembourse le loyer', async () => {
    // Boutique neuve : loyer de 2 semaines, 10 polos en stock vendus à leur prix de gros (demande forte), passage des clients forcé
    await prisma.character.update({ where: { id: P[0]!.character }, data: { locationId: 'mode_adidogome' } });
    await prisma.clothingShop.deleteMany({ where: { characterId: P[0]!.character } });
    const start = await bal(0);
    await svc.rent(P[0]!.account, 2);
    await svc.stock(P[0]!.account, 'polo_beige', 10);
    const shop = await prisma.clothingShop.findFirstOrThrow({ where: { characterId: P[0]!.character } });
    const line = await prisma.clothingShopItem.findFirstOrThrow({ where: { shopId: shop.id, itemId: 'polo_beige' } });
    // Prix = prix de gros (demande maximale 80 %) ; dernier passage il y a 3 jours de jeu : de quoi faire plusieurs visites
    await prisma.clothingShopItem.update({ where: { id: line.id }, data: { price: 3_000 } });
    const settings = new SettingsService(prisma);
    const clock = await settings.clock();
    await prisma.clothingShop.update({ where: { id: shop.id }, data: { lastNpcSaleAt: new Date(Date.now() - (3 * 24 * 60 * 60 * 1000 * clock.secondsPerGameDay) / 86_400) } });
    const before = await bal(0);
    const n = await svc.npcTick();
    const after = await prisma.clothingShopItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(n).toBeGreaterThan(0);
    expect(after.qty).toBe(10 - n);
    expect((await bal(0)) - before).toBe(BigInt(n) * 3_000n - BigInt(n) * 60n); // vente moins 2 % de taxe
    // Fermeture : stock rendu à 50 % du prix de gros (3 600 × 50 % = 1 800 par polo), loyer non consommé remboursé à 50 %
    const q = await svc.state(P[0]!.account);
    const b2 = await bal(0);
    const closed = await svc.closeShop(P[0]!.account);
    expect(BigInt(closed.result.buyback)).toBe(BigInt(after.qty) * 1_800n);
    expect(BigInt(closed.result.refund)).toBeGreaterThan(0n);
    expect((await bal(0)) - b2).toBe(BigInt(closed.result.buyback) + BigInt(closed.result.refund));
    expect(q.shop?.closeQuote.buyback).toBe(closed.result.buyback);
    expect(await prisma.clothingShop.count({ where: { characterId: P[0]!.character } })).toBe(0);
    await expect(svc.closeShop(P[0]!.account)).rejects.toThrow('no_clothing_shop');
    expect(start).toBeGreaterThan(0n);
  });
});
